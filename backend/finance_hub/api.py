import asyncio
import csv
import hmac
import io
import json
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command
from pydantic import ValidationError
from sqlalchemy import and_, select

from .advisor import Advisor
from .config import Settings
from .db import Alert, AppEvent, Database, Evaluation, Holding, Report, ReportSource, ResearchJob, Price
from .db import Snapshot, Trigger, aware, emit, now, row_dict
from .portfolio import portfolio
from .providers import ProviderError, Providers
from .research import ResearchService, brief
from .schemas import ChatInput, DeliveryUpdate, HoldingInput, InjectSignal, ResearchInput, ResumeInput
from .schemas import TriggerCreate, TriggerPatch, seconds
from .triggers import TriggerService
from .views import alert_view, load_alert_view

bearer = HTTPBearer(auto_error=False)
logger = logging.getLogger("finance_hub.api")


def pending_approval(snapshot):
    return any(task.interrupts for task in snapshot.tasks)


def sse(kind, data, event_id=None):
    prefix = f"id: {event_id}\n" if event_id is not None else ""
    return prefix + f"event: {kind}\ndata: {json.dumps(jsonable_encoder(data), allow_nan=False)}\n\n"


async def require_auth(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    expected = request.app.state.settings.api_token
    if not credentials or not hmac.compare_digest(credentials.credentials, expected):
        raise HTTPException(401, "Invalid bearer token", headers={"WWW-Authenticate": "Bearer"})


async def require_notifier(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    token = request.app.state.settings.notifier_token
    if not token or not credentials or not hmac.compare_digest(credentials.credentials, token):
        raise HTTPException(401, "Invalid notifier token")


async def get_row(session, model, item_id):
    row = await session.get(model, item_id)
    if row is None:
        raise HTTPException(404, "Not found")
    return row


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    db = Database(settings)
    providers = Providers(settings, db)
    research = ResearchService(db, providers)
    triggers = TriggerService(db, providers)

    @asynccontextmanager
    async def lifespan(app):
        try:
            await db.initialize()
            async with AsyncExitStack() as stack:
                if db.is_postgres:
                    saver = await stack.enter_async_context(AsyncPostgresSaver.from_conn_string(db.checkpoint_url))
                else:
                    saver = await stack.enter_async_context(
                        AsyncSqliteSaver.from_conn_string(settings.checkpoint_sqlite_path))
                await saver.setup()
                app.state.advisor = Advisor(db, providers, research, saver)
                yield
        finally:
            await providers.close()
            await db.close()

    app = FastAPI(title="Prometheus Backend", version="0.1.0", lifespan=lifespan)
    app.state.settings, app.state.db = settings, db
    app.state.providers, app.state.research, app.state.triggers = providers, research, triggers
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "Last-Event-ID"])

    @app.exception_handler(ProviderError)
    async def provider_failure(request, error):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"detail": str(error)})

    @app.get("/health")
    async def health():
        async with db.sessions() as session:
            from sqlalchemy import text
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "demo": settings.demo_mode}

    auth = [Depends(require_auth)]

    @app.get("/api/portfolio", dependencies=auth)
    async def get_portfolio():
        return await portfolio(db, providers)

    @app.post("/api/holdings", status_code=201, dependencies=auth)
    async def add_holding(data: HoldingInput):
        async with db.sessions() as session:
            item = Holding(data=data.model_dump(mode="json"))
            session.add(item)
            await session.flush()
            emit(session, "portfolio_updated", {"holding_id": item.id})
            await session.commit()
            return {"id": item.id, **item.data}

    @app.patch("/api/holdings/{holding_id}", dependencies=auth)
    async def patch_holding(holding_id: str, patch: dict):
        async with db.sessions() as session:
            item = await get_row(session, Holding, holding_id)
            try:
                item.data = HoldingInput.model_validate({**item.data, **patch}).model_dump(mode="json")
            except ValidationError as error:
                raise HTTPException(422, jsonable_encoder(error.errors(), custom_encoder={ValueError: str})) from None
            emit(session, "portfolio_updated", {"holding_id": item.id})
            await session.commit()
            return {"id": item.id, **item.data}

    @app.delete("/api/holdings/{holding_id}", status_code=204, dependencies=auth)
    async def delete_holding(holding_id: str):
        async with db.sessions() as session:
            await session.delete(await get_row(session, Holding, holding_id))
            emit(session, "portfolio_updated", {"holding_id": holding_id})
            await session.commit()

    @app.post("/api/holdings/import", dependencies=auth)
    async def import_holdings(file: UploadFile):
        raw = await file.read(1_000_001)
        if len(raw) > 1_000_000:
            raise HTTPException(413, "CSV limit is 1 MB")
        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), strict=True)
            if not reader.fieldnames or "asset_class" not in reader.fieldnames or "name" not in reader.fieldnames:
                raise HTTPException(422, "CSV requires asset_class and name headers")
            if len(set(reader.fieldnames)) != len(reader.fieldnames):
                raise HTTPException(422, "Duplicate CSV headers")
            valid, errors = [], []
            for line, row in enumerate(reader, start=2):
                if None in row or any(value is None for value in row.values()):
                    raise HTTPException(422, f"CSV row {line} does not match the header columns")
                if line > 1001:
                    raise HTTPException(413, "CSV limit is 1000 rows")
                try:
                    valid.append(HoldingInput.model_validate({k: v.strip() for k, v in row.items()
                                                             if k and v and isinstance(v, str)}))
                except ValidationError as error:
                    errors.append({"row": line, "errors": jsonable_encoder(error.errors(),
                                                                          custom_encoder={ValueError: str})})
        except (UnicodeDecodeError, csv.Error):
            raise HTTPException(422, "Invalid UTF-8 CSV") from None
        if errors:
            # All-or-nothing validation avoids duplicate partial imports on retry.
            raise HTTPException(422, {"imported": 0, "rows": errors})
        async with db.sessions() as session:
            items = [Holding(data=h.model_dump(mode="json")) for h in valid]
            session.add_all(items)
            await session.flush()
            emit(session, "portfolio_updated", {"count": len(items)})
            await session.commit()
            return {"imported": len(items), "ids": [h.id for h in items]}

    @app.get("/api/networth/history", dependencies=auth)
    async def history(range_: str = Query("1M", alias="range", pattern="^(1M|3M|1Y|All)$")):
        cutoff = now() - timedelta(days={"1M": 31, "3M": 93, "1Y": 366, "All": 36500}[range_])
        async with db.sessions() as session:
            rows = (await session.scalars(select(Snapshot).where(Snapshot.ts >= cutoff)
                                          .order_by(Snapshot.ts))).all()
            # Daily latest observation; the optional Timescale continuous aggregate mirrors this in production.
            days = {}
            for row in rows:
                days[row.ts.date().isoformat()] = row_dict(row)
            return {"range": range_, "series": list(days.values())}

    async def graph_stream(request, thread_id, input_, lock):
        queue = asyncio.Queue()

        async def run():
            try:
                graph = app.state.advisor.graph
                streamed = False
                async for mode, update in graph.astream(input_, {"configurable": {"thread_id": thread_id}},
                                                        stream_mode=["updates", "custom"]):
                    if mode == "custom":
                        if "token" in update:
                            streamed = True
                            await queue.put(("token", {"text": update["token"]}))
                        else:
                            await queue.put(("tool", {"name": "turn_context", "data": {}}))
                        continue
                    for node, value in update.items():
                        if node == "__interrupt__":
                            for item in value:
                                await queue.put(("trigger_approval", item.value))
                        elif node == "answer":
                            context = value.get("context", {})
                            await queue.put(("tool", {"name": "turn_context", "data": context}))
                            answer = value["answer"]
                            for index in range(0, len(answer) if not streamed else 0, 80):
                                await queue.put(("token", {"text": answer[index:index+80]}))
                            await queue.put(("answer", {"text": answer}))
                        elif node == "apply":
                            await queue.put(("triggers_updated", value["result"]))
                        elif node == "route":
                            await queue.put(("intent", {"intent": value["intent"]}))
                await queue.put(("done", {"thread_id": thread_id}))
            except Exception:
                logger.exception("Chat execution failed")
                await queue.put(("error", {"message": "Chat failed; check provider configuration and retry."}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        try:
            yield sse("thread", {"thread_id": thread_id, "demo": settings.demo_mode})
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=10)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                if event is None:
                    break
                yield sse(*event)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            lock.release()

    async def acquire_thread(thread_id):
        lock = app.state.advisor.thread_lock(thread_id)
        if lock.locked():
            raise HTTPException(409, "Thread is busy")
        await lock.acquire()
        return lock

    @app.post("/api/chat", dependencies=auth)
    async def chat(data: ChatInput, request: Request):
        thread_id = data.thread_id or str(uuid4())
        lock = await acquire_thread(thread_id)
        try:
            snapshot = await app.state.advisor.graph.aget_state({"configurable": {"thread_id": thread_id}})
            if pending_approval(snapshot):
                raise HTTPException(409, "Resolve pending trigger approvals with the resume endpoint first")
            if snapshot.next:
                raise HTTPException(409, "Previous turn failed; retry it with POST /api/chat/{thread_id}/retry")
        except BaseException:
            lock.release()
            raise
        payload = {"message": data.message, "thread_id": thread_id, "turn_id": str(uuid4())}
        return StreamingResponse(graph_stream(request, thread_id, payload, lock), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/chat/{thread_id}", dependencies=auth)
    async def chat_state(thread_id: str):
        snapshot = await app.state.advisor.graph.aget_state({"configurable": {"thread_id": thread_id}})
        if not snapshot.values:
            raise HTTPException(404, "Thread not found")
        return {"thread_id": thread_id, "history": snapshot.values.get("history", []),
                "proposals": snapshot.values.get("proposals", []), "awaiting_approval": bool(pending_approval(snapshot)),
                "retryable": bool(snapshot.next) and not pending_approval(snapshot),
                "research_job": snapshot.values.get("context", {}).get("research_job")}

    @app.post("/api/chat/{thread_id}/resume", dependencies=auth)
    async def resume(thread_id: str, data: ResumeInput, request: Request):
        lock = await acquire_thread(thread_id)
        try:
            snapshot = await app.state.advisor.graph.aget_state({"configurable": {"thread_id": thread_id}})
            if not pending_approval(snapshot) or not snapshot.values.get("proposals"):
                raise HTTPException(409, "No pending trigger approval")
            ids = [d.proposal_id for d in data.decisions]
            expected = {p["proposal_id"] for p in snapshot.values["proposals"]}
            if len(ids) != len(set(ids)) or set(ids) != expected:
                raise HTTPException(422, "Send exactly one approve/edit/reject decision for each pending proposal")
        except BaseException:
            lock.release()
            raise
        return StreamingResponse(graph_stream(request, thread_id,
            Command(resume=[d.model_dump(mode="json", exclude_none=True) for d in data.decisions]), lock),
            media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/chat/{thread_id}/retry", dependencies=auth)
    async def retry_chat(thread_id: str, request: Request):
        lock = await acquire_thread(thread_id)
        try:
            snapshot = await app.state.advisor.graph.aget_state({"configurable": {"thread_id": thread_id}})
            if not snapshot.next or pending_approval(snapshot):
                raise HTTPException(409, "No failed turn to retry; use resume for pending approvals")
        except BaseException:
            lock.release()
            raise
        return StreamingResponse(graph_stream(request, thread_id, None, lock), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/triggers", dependencies=auth)
    async def list_triggers():
        async with db.sessions() as session:
            severity = (select(Evaluation.severity).where(Evaluation.trigger_id == Trigger.id)
                        .order_by(Evaluation.ts.desc()).limit(1).correlate(Trigger).scalar_subquery())
            rows = (await session.execute(select(Trigger, severity).where(Trigger.status != "deleted")
                                           .order_by(Trigger.created_at.desc()))).all()
            # Price alerts show progress to their target, using the worker's latest quote.
            result = []
            for trigger, last in rows:
                query = next((s["query"] for s in trigger.spec["signals"] if s["detector"] == "price_level"), None)
                price = await session.scalar(select(Price.price).where(Price.ticker == query)
                                             .order_by(Price.ts.desc()).limit(1)) if query else None
                event = {k: v for k, v in trigger.next_polls.get("event", {}).items() if k != "seen"}
                result.append({**row_dict(trigger, exclude=("next_polls",)), "last_severity": last,
                               "latest_price": price, "event_state": event or None})
            return result

    @app.post("/api/triggers", status_code=201, dependencies=auth)
    async def create_trigger(data: TriggerCreate):
        async with db.sessions() as session:
            trigger = Trigger(spec=data.spec.model_dump(mode="json"))
            session.add(trigger)
            await session.flush()
            emit(session, "trigger_status", {"trigger_id": trigger.id, "status": trigger.status})
            await session.commit()
            return row_dict(trigger)

    @app.patch("/api/triggers/{trigger_id}", dependencies=auth)
    async def patch_trigger(trigger_id: str, data: TriggerPatch):
        async with db.sessions() as session:
            item = await get_row(session, Trigger, trigger_id)
            if item.status == "deleted":
                raise HTTPException(404, "Not found")
            if data.spec:
                item.spec, item.next_polls = data.spec.model_dump(mode="json"), {}
            if data.status:
                item.status = data.status
                # Pausing shouldn't forget an event's outcome or re-check old articles.
                item.next_polls = {k: v for k, v in item.next_polls.items() if k == "event"}
            emit(session, "trigger_status", {"trigger_id": item.id, "status": item.status})
            await session.commit()
            return row_dict(item)

    @app.delete("/api/triggers/{trigger_id}", status_code=204, dependencies=auth)
    async def delete_trigger(trigger_id: str):
        async with db.sessions() as session:
            item = await get_row(session, Trigger, trigger_id)
            item.status = "deleted"
            emit(session, "trigger_status", {"trigger_id": item.id, "status": "deleted"})
            await session.commit()

    @app.get("/api/triggers/{trigger_id}/evaluations", dependencies=auth)
    async def evaluations(trigger_id: str, since: datetime | None = None, limit: int = Query(500, ge=1, le=5000)):
        async with db.sessions() as session:
            await get_row(session, Trigger, trigger_id)
            query = select(Evaluation).where(Evaluation.trigger_id == trigger_id,
                       Evaluation.ts >= aware(since) if since else Evaluation.ts >= now() - timedelta(days=1))
            rows = (await session.scalars(query.order_by(Evaluation.ts.desc()).limit(limit))).all()
            return [row_dict(e) for e in reversed(rows)]

    @app.get("/api/alerts", dependencies=auth)
    async def alerts(status: str = Query("open", pattern="^(open|acked|all)$"),
                     limit: int = Query(100, ge=1, le=500)):
        async with db.sessions() as session:
            query = select(Alert)
            if status == "open":
                query = query.where(Alert.acked_at.is_(None))
            elif status == "acked":
                query = query.where(Alert.acked_at.is_not(None))
            query = query.add_columns(Trigger, Evaluation).join(Trigger, Alert.trigger_id == Trigger.id)
            query = query.outerjoin(Evaluation, and_(Evaluation.id == Alert.evaluation_id,
                                                     Evaluation.ts == Alert.evaluation_ts))
            rows = (await session.execute(query.order_by(Alert.created_at.desc()).limit(limit))).all()
            return [alert_view(a, t, e, settings.demo_mode) for a, t, e in rows]

    @app.post("/api/alerts/{alert_id}/ack", dependencies=auth)
    async def ack(alert_id: str):
        async with db.sessions() as session:
            item = await get_row(session, Alert, alert_id)
            item.acked_at, item.delivery_status = now(), "acknowledged"
            emit(session, "delivery_status", {"alert_id": item.id, "status": "acknowledged"})
            await session.commit()
            return await load_alert_view(session, item, settings.demo_mode)

    @app.post("/api/alerts/{alert_id}/snooze", dependencies=auth)
    async def snooze(alert_id: str, duration: str = Query("24h", pattern=r"^[1-9][0-9]{0,3}[mhd]$")):
        if seconds(duration) > 30 * 86400:
            raise HTTPException(422, "Maximum snooze is 30 days")
        async with db.sessions() as session:
            item = await get_row(session, Alert, alert_id)
            item.snoozed_until = now() + timedelta(seconds=seconds(duration))
            emit(session, "alert_snoozed", {"alert_id": item.id, "until": item.snoozed_until.isoformat()})
            await session.commit()
            return await load_alert_view(session, item, settings.demo_mode)

    @app.patch("/api/internal/alerts/{alert_id}/delivery", dependencies=[Depends(require_notifier)])
    async def delivery_callback(alert_id: str, data: DeliveryUpdate):
        async with db.sessions() as session:
            item = await get_row(session, Alert, alert_id)
            if not item.acked_at and (data.status == "acknowledged"
                                      or item.delivery_status not in ("delivered", "text_fallback")):
                item.delivery_status = data.status
                if data.status == "acknowledged":
                    item.acked_at = now()
                emit(session, "delivery_status", {"alert_id": item.id, "status": item.delivery_status})
                await session.commit()
            return row_dict(item)

    @app.get("/api/events", dependencies=auth)
    async def events(request: Request, after: int | None = Query(None, ge=0)):
        try:
            last_id = int(request.headers.get("Last-Event-ID", "0"))
        except ValueError:
            raise HTTPException(422, "Last-Event-ID must be an integer") from None
        cursor = after if after is not None else last_id

        async def stream():
            nonlocal cursor
            yield sse("connected", {"after": cursor})
            while not await request.is_disconnected():
                async with db.sessions() as session:
                    rows = (await session.scalars(select(AppEvent).where(AppEvent.id > cursor)
                                                  .order_by(AppEvent.id).limit(100))).all()
                for row in rows:
                    cursor = row.id
                    yield sse(row.kind, row.payload, row.id)
                if not rows:
                    yield ": heartbeat\n\n"
                    await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/research", status_code=202, dependencies=auth)
    async def start_research(data: ResearchInput):
        return await research.enqueue(data)

    @app.get("/api/research/{job_id}", dependencies=auth)
    async def get_research(job_id: str):
        async with db.sessions() as session:
            return row_dict(await get_row(session, ResearchJob, job_id))

    @app.get("/api/reports", dependencies=auth)
    async def reports(q: str | None = Query(None, max_length=1000)):
        if q:
            return await research.search(q)
        async with db.sessions() as session:
            return {"reports": [brief(r) for r in (await session.scalars(select(Report)
                                 .order_by(Report.created_at.desc()).limit(50))).all()]}

    @app.get("/api/reports/{report_id}", dependencies=auth)
    async def get_report(report_id: str):
        async with db.sessions() as session:
            report = await get_row(session, Report, report_id)
            sources = (await session.scalars(select(ReportSource).where(ReportSource.report_id == report_id))).all()
            return {**row_dict(report, exclude=("summary_embedding",)), "sources": [row_dict(s) for s in sources],
                    "similar": await research.similar(report_id)}

    @app.post("/api/dev/inject-signal", dependencies=auth)
    async def inject(data: InjectSignal):
        if not settings.enable_dev_injection:
            raise HTTPException(404, "Not found")
        async with db.sessions() as session:
            await get_row(session, Trigger, data.trigger_id)
        evidence = {"source": data.source, "external_id": data.external_id,
                    "title": data.title, "url": str(data.url), "synthetic": True}
        try:
            return await triggers.evaluate(data.trigger_id, evidence, data.magnitude, injected=data)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    return app
