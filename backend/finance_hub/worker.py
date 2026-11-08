"""Run separately from Uvicorn: finance-worker. Exactly one worker per database."""
import asyncio
import fcntl
import hashlib
import logging
import os
from contextlib import asynccontextmanager

from sqlalchemy import select, text

from .config import Settings
from .db import Database, Snapshot, Trigger, now
from .market import market_open
from .portfolio import portfolio
from .providers import Providers
from .research import ResearchService
from .triggers import TriggerService

logger = logging.getLogger("finance_hub.worker")


@asynccontextmanager
async def worker_lock(db):
    if db.is_postgres:
        async with db.engine.connect() as connection:
            acquired = await connection.scalar(text("SELECT pg_try_advisory_lock(2026110701)"))
            await connection.commit()
            if not acquired:
                raise RuntimeError("Another finance worker is already running")
            try:
                yield
            finally:
                await connection.execute(text("SELECT pg_advisory_unlock(2026110701)"))
                await connection.commit()
    else:
        identifier = hashlib.sha256(str(db.engine.url).encode()).hexdigest()[:16]
        descriptor = os.open(f"/tmp/finance-worker-{identifier}.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Another finance worker is already running") from None
            yield
        finally:
            os.close(descriptor)


async def price_loop(db, providers):
    while True:
        try:
            # First pass refreshes on startup; thereafter cache/market-hour policy controls requests.
            for ticker in await providers.watched_tickers():
                try:
                    await providers.quote(ticker, refresh=market_open())
                except Exception as error:
                    logger.warning("Quote refresh failed for %s (%s)", ticker, type(error).__name__)
            values = await portfolio(db, providers, refresh=False)
            if values["complete"]:
                # One observation per UTC day. After-close reads replace today's intraday observation.
                ts = now().replace(hour=0, minute=0, second=0, microsecond=0)
                async with db.sessions() as session:
                    snapshot = await session.get(Snapshot, ts)
                    if not snapshot:
                        snapshot = Snapshot(ts=ts)
                        session.add(snapshot)
                    snapshot.total = values["total"]
                    snapshot.cash, snapshot.cd, snapshot.stocks = (
                        values["allocation"][k] for k in ("cash", "cd", "stocks"))
                    await session.commit()
        except Exception as error:
            logger.warning("Portfolio snapshot failed (%s)", type(error).__name__)
        await asyncio.sleep(60)


async def trigger_loop(db, service, interval):
    while True:
        try:
            async with db.sessions() as session:
                triggers = (await session.scalars(select(Trigger).where(Trigger.status == "active"))).all()
            for trigger in triggers:
                try:
                    await service.poll_trigger(trigger)
                except Exception as error:
                    logger.warning("Trigger %s failed (%s)", trigger.id, type(error).__name__)
        except Exception as error:
            logger.warning("Trigger scheduler failed (%s)", type(error).__name__)
        await asyncio.sleep(interval)


async def delivery_loop(service):
    while True:
        try:
            if await service.dispatch_next():
                continue
        except Exception as error:
            logger.warning("Delivery processing failed (%s)", type(error).__name__)
        await asyncio.sleep(1)


async def research_loop(service):
    while True:
        try:
            if await service.run_next():
                continue
        except Exception as error:
            logger.warning("Research worker failed (%s)", type(error).__name__)
        await asyncio.sleep(2)


async def run(settings=None):
    settings = settings or Settings()
    db = Database(settings)
    providers = Providers(settings, db)
    try:
        await db.initialize()
        async with worker_lock(db):
            logger.info("Worker started (%s)", "DEMO; no phone delivery" if settings.demo_mode else "live")
            async with asyncio.TaskGroup() as group:
                group.create_task(price_loop(db, providers))
                group.create_task(trigger_loop(db, TriggerService(db, providers), settings.worker_interval_seconds))
                group.create_task(delivery_loop(TriggerService(db, providers)))
                group.create_task(research_loop(ResearchService(db, providers)))
    finally:
        await providers.close()
        await db.close()


def main():
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
