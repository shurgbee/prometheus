import json

from fastapi.testclient import TestClient

from finance_hub.api import create_app

TOKEN = "a-long-test-token-for-backend"



def seed_holdings(client):
    for row in ({"asset_class": "cash", "name": "Cash", "principal": 96000},
                {"asset_class": "stock", "name": "Tesla", "ticker": "TSLA", "quantity": 16, "cost_basis": 3500}):
        assert client.post("/api/holdings", json=row).status_code == 201


def parse_sse(response, kind):
    events = response.text.split("\n\n")
    return [json.loads(line[6:]) for event in events if f"event: {kind}\n" in event
            for line in event.splitlines() if line.startswith("data: ")]


def approve_chat(client):
    response = client.post("/api/chat", json={"message": "I see many Teslas on the road, why?"})
    assert response.status_code == 200
    assert not parse_sse(response, "error"), response.text
    thread = parse_sse(response, "thread")[0]["thread_id"]
    cards = parse_sse(response, "trigger_approval")[0]["proposals"]
    assert len(cards) == 3
    assert client.get("/api/triggers").json() == []
    return thread, cards


def test_auth_validation_portfolio_and_atomic_csv(client):
    assert client.get("/api/portfolio", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/api/holdings", json={"asset_class": "stock", "name": "Invalid"}).status_code == 422
    seed_holdings(client)
    result = client.get("/api/portfolio").json()
    assert result["total"] == 100000 and result["demo"]
    assert result["holdings"][1]["gain"] == 500
    csv = "asset_class,name,principal\ncash,Valid,20\ncd,Invalid,20\n"
    response = client.post("/api/holdings/import", files={"file": ("holdings.csv", csv, "text/csv")})
    assert response.status_code == 422
    assert len(client.get("/api/portfolio").json()["holdings"]) == 2
    row = result["holdings"][0]
    assert client.patch(f"/api/holdings/{row['id']}", json={"principal": 100}).status_code == 200
    assert client.patch(f"/api/holdings/{row['id']}", json={"principal": -1}).status_code == 422


def test_approval_resume_survives_restart_and_is_exactly_once(app, client):
    seed_holdings(client)
    thread, cards = approve_chat(client)
    assert client.post("/api/chat", json={"thread_id": thread, "message": "Next"}).status_code == 409
    assert client.post(f"/api/chat/{thread}/resume", json={"decisions": [
        {"proposal_id": "wrong", "action": "approve"}]}).status_code == 422
    # A second application opens the same durable graph checkpoint.
    restarted = create_app(app.state.settings)
    with TestClient(restarted, headers={"Authorization": f"Bearer {TOKEN}"}) as other:
        assert other.get(f"/api/chat/{thread}").json()["awaiting_approval"]
        payload = {"decisions": [{"proposal_id": c["proposal_id"], "action": "approve"} for c in cards]}
        response = other.post(f"/api/chat/{thread}/resume", json=payload)
        assert not parse_sse(response, "error"), response.text
        assert len(other.get("/api/triggers").json()) == 3
        assert other.post(f"/api/chat/{thread}/resume", json=payload).status_code == 409


def test_reject_and_edit_do_not_auto_create(client):
    seed_holdings(client)
    thread, cards = approve_chat(client)
    edited = {**cards[0]["spec"], "name": "User-edited watch"}
    decisions = [{"proposal_id": cards[0]["proposal_id"], "action": "edit", "spec": edited},
                 *[{"proposal_id": c["proposal_id"], "action": "reject"} for c in cards[1:]]]
    response = client.post(f"/api/chat/{thread}/resume", json={"decisions": decisions})
    assert not parse_sse(response, "error"), response.text
    assert [t["spec"]["name"] for t in client.get("/api/triggers").json()] == ["User-edited watch"]


def create_watch(client, critical=True):
    spec = {"name": "Watch", "entity": "Tesla", "tickers": ["TSLA"], "hypothesis": "Synthetic tests",
            "critical_capable": critical, "signals": [{"source": "news", "query": "Tesla", "detector": "text_event"}]}
    assert client.post("/api/triggers", json={"spec": spec}).status_code == 422
    return client.post("/api/triggers", json={"spec": spec, "approved": True}).json()["id"]


def inject(client, trigger_id, external_id="event-1", **patch):
    return client.post("/api/dev/inject-signal", json={"trigger_id": trigger_id, "source": "sec_edgar",
        "external_id": external_id, "title": "Synthetic SEC event", "url": "https://www.sec.gov/edgar/search/",
        "magnitude": 1, "urgency": 1, **patch})


def test_notifier_retry_state_uses_notifier_auth_and_exposes_ack_and_snooze(client):
    seed_holdings(client)
    trigger = create_watch(client)
    result = inject(client, trigger).json()
    alert_id = result["alert"]["id"]
    path = f"/api/internal/alerts/{alert_id}/state"
    assert client.get(path).status_code == 401
    headers = {"Authorization": "Bearer notifier-test-token"}
    state = client.get(path, headers=headers).json()
    assert state == {"acked_at": None, "snoozed_until": None, "trigger_status": "active"}
    assert client.post(f"/api/alerts/{alert_id}/snooze?duration=1h").status_code == 200
    assert client.get(path, headers=headers).json()["snoozed_until"]
    client.post(f"/api/alerts/{alert_id}/ack")
    assert client.get(path, headers=headers).json()["acked_at"]


def test_injection_gates_dedupe_cooldown_ack_and_callback(client, app):
    seed_holdings(client)
    trigger = create_watch(client)
    first = inject(client, trigger).json()
    assert first["evaluation"]["level"] == "Critical"
    assert first["evaluation"]["severity"] == 85
    assert first["alert"]["evidence"][0]["event_id"]
    assert inject(client, trigger).json()["duplicate"]
    second = inject(client, trigger, "different-event").json()
    assert second["alert"] is None and second["evaluation"]["suppressed_reason"] == "cooldown"
    alert_id = first["alert"]["id"]
    assert client.post(f"/api/alerts/{alert_id}/ack").status_code == 200
    assert client.get("/api/alerts").json() == []
    callback = client.patch(f"/api/internal/alerts/{alert_id}/delivery", json={"status": "delivered"},
                           headers={"Authorization": "Bearer notifier-test-token"})
    assert callback.json()["delivery_status"] == "acknowledged"
    capped = inject(client, create_watch(client, critical=False)).json()
    assert capped["evaluation"]["level"] == "Normal"
    app.state.settings.enable_dev_injection = False
    assert inject(client, trigger, "disabled").status_code == 404


def test_demo_delivery_is_durable_and_global_call_limit(client, app):
    seed_holdings(client)
    alert_ids = [inject(client, create_watch(client), f"event-{i}").json()["alert"]["id"] for i in range(2)]
    for _ in range(2):
        assert client.portal.call(app.state.triggers.dispatch_next)
    alerts = client.get("/api/alerts?status=all").json()
    by_id = {a["id"]: a for a in alerts}
    assert [by_id[i]["channel"] for i in alert_ids] == ["call", "text"]
    assert {a["delivery_status"] for a in alerts} == {"demo_recorded"}


def test_background_research_and_semantic_search(client, app):
    seed_holdings(client)
    report_ids = []
    for topic in ("EV tax incentives", "US auto market", "Tesla charging network", "EV subsidy policy"):
        response = client.post("/api/research", json={"topic": topic, "tickers": ["TSLA"]})
        assert response.status_code == 202
        job = response.json()
        assert job["status"] == "queued"
        assert client.portal.call(app.state.research.run_next)
        finished = client.get(f"/api/research/{job['id']}").json()
        assert finished["status"] == "completed", finished
        report_ids.append(finished["report_id"])
    results = client.get("/api/reports?q=EV%20subsidies").json()
    assert len(results["matches"]) == 3
    assert len(results["similar"]) == 1
    assert not {r["id"] for r in results["matches"]} & {r["id"] for r in results["similar"]}
    report = client.get(f"/api/reports/{report_ids[0]}").json()
    assert report["sources"] and "Educational, not financial advice." in report["body_md"]
    assert len(report["similar"]) == 3


def test_no_trading_tools(client):
    response = client.post("/api/chat", json={"message": "buy TSLA"})
    assert "cannot place trades" in parse_sse(response, "answer")[0]["text"]
    assert not parse_sse(response, "trigger_approval")


def test_frontend_read_models_and_timezone_contract(client):
    seed_holdings(client)
    portfolio = client.get("/api/portfolio").json()
    assert portfolio["complete"] and portfolio["demo"] and portfolio["dev_injection_enabled"]
    assert isinstance(portfolio["market_open"], bool)
    stock = next(h for h in portfolio["holdings"] if h["asset_class"] == "stock")
    assert stock["cost_basis"] == 3500 and stock["day_change_percent"] == 0
    trigger_id = create_watch(client)
    result = inject(client, trigger_id).json()
    alert = result["alert"]
    assert alert["trigger_name"] == "Watch" and alert["rationale"]
    assert abs(alert["breakdown"]["exposure"] - .4) < 1e-12
    assert alert["demo"] and alert["created_at"].endswith("+00:00")
    listed = client.get("/api/alerts").json()[0]
    assert listed["breakdown"] == alert["breakdown"]
    trigger = next(t for t in client.get("/api/triggers").json() if t["id"] == trigger_id)
    assert trigger["last_severity"] == 85
    acked = client.post(f"/api/alerts/{alert['id']}/ack").json()
    assert acked["trigger_name"] == "Watch" and acked["breakdown"]
    assert client.get("/api/networth/history?range=All").status_code == 200


def test_failed_turn_can_be_recovered_without_treating_it_as_an_approval(client, app, monkeypatch):
    from finance_hub.providers import ProviderError
    enqueue = app.state.research.enqueue
    calls = 0

    async def fail_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ProviderError("Temporary test failure")
        return await enqueue(*args, **kwargs)

    monkeypatch.setattr(app.state.research, "enqueue", fail_once)
    response = client.post("/api/chat", json={"message": "Write an EV research report"})
    thread = parse_sse(response, "thread")[0]["thread_id"]
    assert parse_sse(response, "error")
    state = client.get(f"/api/chat/{thread}").json()
    assert state["retryable"] and not state["awaiting_approval"]
    assert client.post(f"/api/chat/{thread}/resume", json={"decisions": [
        {"proposal_id": "not-an-approval", "action": "reject"}]}).status_code == 409
    retried = client.post(f"/api/chat/{thread}/retry")
    assert not parse_sse(retried, "error"), retried.text
    assert parse_sse(retried, "done")
    restored = client.get(f"/api/chat/{thread}").json()
    assert not restored["retryable"]
    assert restored["research_job"]["status"] == "queued"
