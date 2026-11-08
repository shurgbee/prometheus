import json

from fastapi.testclient import TestClient

from finance_hub.advisor import CitationStream, enforce_citations, expand_citations, for_model, stock_rankings
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


def test_numeric_flags_accepts_datetime_context():
    # Live-mode advisor context includes datetimes (quote timestamps); flagging must not crash on them.
    from datetime import datetime, timezone
    from finance_hub.providers import numeric_flags
    context = {"prices": [{"ticker": "TSLA", "price": 412.5, "ts": datetime(2026, 11, 7, tzinfo=timezone.utc)}]}
    assert numeric_flags("TSLA trades at 412.5, up 9.9%.", context) == ["9.9"]


def test_numeric_flags_matches_values_not_formatting():
    from finance_hub.providers import numeric_flags
    context = {"total": 121892.78, "cash": 30000.0, "apy": 0.045, "weight": 0.246118, "change": -0.36,
               "maturity_date": "2027-05-01", "quote_ts": "2026-11-06T21:00:00+00:00"}
    answer = ("1. Net worth is $121,892.78 (about $121,893), with $30,000.00 in cash (24.61% or 24.6%).\n"
              "2. The CD earns 4.50% and matures 2027-05-01; the price moved +0.36 as of 2026-11-06T21:00:00Z.\n"
              "You hold 2 CDs. See [source](https://example.com/2024/987654).")
    assert numeric_flags(answer, context) == []


def test_numeric_flags_still_flags_unsupported_figures():
    from finance_hub.providers import numeric_flags
    context = {"total": 121892.78, "weight": 0.246118}
    assert numeric_flags("Net worth is $125,000 and stocks are 31.5% of it, up 63.76%.", context) == \
        ["125,000", "31.5", "63.76"]


def test_chat_answers_do_not_repeat_the_disclaimer(client):
    seed_holdings(client)
    for message in ("How is my money split?", "buy TSLA"):
        answer = parse_sse(client.post("/api/chat", json={"message": message}), "answer")[0]["text"]
        assert "not financial advice" not in answer


def test_enforce_citations_unlinks_only_unknown_urls():
    good, bad = "https://example.com/a", "https://invented.example/b"
    text, removed, kept = enforce_citations(f"One [Reuters]({good}). Two [Blog]({bad}).", {good})
    assert text == f"One [Reuters]({good}). Two Blog."
    assert (removed, kept) == ([bad], [good])
    assert enforce_citations("A CD ladder staggers maturities.", set()) == ("A CD ladder staggers maturities.", [], [])


def test_stock_rankings_combine_lots_and_order_by_value():
    ranked = stock_rankings([{"ticker": "NVDA", "value": 14.0, "weight": 0.1}, {"name": "Cash", "value": 99.0},
                             {"ticker": "AAPL", "value": 10.0, "weight": 0.1}, {"ticker": "AAPL", "value": 7.0, "weight": 0.05},
                             {"ticker": "TSLA", "value": None, "weight": None}])
    assert [row["ticker"] for row in ranked["stocks_by_value"]] == ["AAPL", "NVDA"]
    assert ranked["largest_stock"] == "AAPL" and ranked["smallest_stock"] == "NVDA"
    assert stock_rankings([])["largest_stock"] is None


def test_for_model_rounds_only_display_figures():
    data = {"quotes": [{"change_percent": 2.7753, "price": 0.01234}], "portfolio": {"weight": 0.114839, "total": 1.23456}}
    assert for_model(data) == {"quotes": [{"change_percent": 2.78, "price": 0.0123}],
                               "portfolio": {"weight": 0.1148, "total": 1.23456}}


def test_sources_list_contains_only_cited_articles(client):
    seed_holdings(client)
    response = client.post("/api/chat", json={"message": "I see many Teslas on the road, why?"})
    context = next(e["data"] for e in parse_sse(response, "tool") if e["name"] == "turn_context")
    answer = parse_sse(response, "answer")[0]["text"]
    assert context["cited_sources"] and all(s["url"] in answer for s in context["cited_sources"])
    assert context["rankings"]["largest_stock"] == "TSLA"
    assert context["quotes"][0]["quote_date"]


def test_numeric_flags_ignore_written_dates_but_not_figures():
    from finance_hub.providers import numeric_flags
    for text in ("Stale as of November 6, 2026.", "Quote from Nov. 17, 2026 and 6 November 2026.", "Since October 2026."):
        assert numeric_flags(text, {}) == [], text
    assert numeric_flags("Revenue rose 37.5% in November 2026.", {}) == ["37.5"]
    assert numeric_flags("Shares hit 450 on Nov 17.", {}) == ["450"]
    assert numeric_flags("May 15% of holdings", {}) == ["15"]


SOURCES = {"S1": {"url": "https://a.example/1"}, "S2": {"url": "https://a.example/2"}, "S3": {"url": "https://a.example/1"}}


def test_expand_citations_numbers_by_first_appearance_and_drops_unknown():
    numbers = {}
    text = expand_citations("Up [S2]. Down [S1, S2]. Gone [S9]. Same url [S3].", SOURCES, numbers)
    assert text == ("Up [1](https://a.example/2). Down [2](https://a.example/1) [1](https://a.example/2). "
                    "Gone . Same url [2](https://a.example/1).")
    assert expand_citations("See [note] and [1].", SOURCES, {}) == "See [note] and [1]."


def test_citation_stream_handles_markers_split_across_chunks():
    stream = CitationStream(SOURCES, {})
    output = [stream.feed(chunk) for chunk in ("Up [", "S", "1", "] and [no", "te] end [S2")]
    assert output[:3] == ["Up ", "", ""]
    assert "".join(output) + stream.flush() == "Up [1](https://a.example/1) and [note] end [S2"


def test_numeric_flags_ignore_citation_numbers():
    from finance_hub.providers import numeric_flags
    assert numeric_flags("Claim [25](https://a.example/1).", {}) == []


def live_quotes(app, monkeypatch, price, triage=None):
    from datetime import datetime, timezone
    calls = []

    async def quote(ticker, refresh=True):
        return {"ticker": ticker, "price": price, "previous_close": price, "change_percent": 0.0, "demo": False,
                "ts": datetime.now(timezone.utc)}

    async def chat(role, system, payload, json_output=False):
        calls.append(payload)
        return triage
    provider = app.state.providers
    monkeypatch.setattr(provider.settings, "demo_mode", False)
    monkeypatch.setattr(provider, "quote", quote)
    monkeypatch.setattr(provider, "chat", chat)
    return calls


ROUTED = {"intent": "new_alert", "tickers": ["BINANCE:BTCUSDT", "BTC"], "alert": {"symbol": "BTC", "name": "Bitcoin", "price": 100000}}


def test_chat_drafts_a_bitcoin_level_alert_for_approval(client, app, monkeypatch):
    live_quotes(app, monkeypatch, 75000.5, ROUTED)
    response = client.post("/api/chat", json={"message": "Create an alert for when bitcoin reaches 100k"})
    assert not parse_sse(response, "error"), response.text
    answer = parse_sse(response, "answer")[0]["text"]
    assert "rises to $100,000" in answer and "Could not match" not in answer
    card = parse_sse(response, "trigger_approval")[0]["proposals"][0]
    assert card["spec"]["signals"][0]["query"] == "BINANCE:BTCUSDT"
    assert card["spec"]["signals"][0]["params"] == {"level": 100000.0, "direction": "above"}
    assert client.get("/api/triggers").json() == []


def test_alert_request_without_a_price_asks_instead_of_listing(client, app, monkeypatch):
    live_quotes(app, monkeypatch, 75000.5, {**ROUTED, "alert": {"symbol": "BTC", "price": None}})
    response = client.post("/api/chat", json={"message": "alert me about bitcoin"})
    answer = parse_sse(response, "answer")[0]["text"]
    assert "What should I watch for" in answer and "Could not match" not in answer
    assert not parse_sse(response, "trigger_approval")


def test_empty_trigger_list_has_a_real_message(client, app, monkeypatch):
    live_quotes(app, monkeypatch, 75000.5, {"intent": "triggers", "tickers": []})
    answer = parse_sse(client.post("/api/chat", json={"message": "show my triggers"}), "answer")[0]["text"]
    assert "don't have any triggers" in answer


def level_trigger(client, app, direction="above"):
    spec = {"name": "Bitcoin reaches $100,000", "entity": "Bitcoin", "tickers": ["BTC"], "hypothesis": "Requested",
            "signals": [{"source": "price", "query": "BINANCE:BTCUSDT", "detector": "price_level",
                         "params": {"level": 100000, "direction": direction}, "poll": "1m"}]}
    created = client.post("/api/triggers", json={"spec": spec, "approved": True})
    assert created.status_code == 201, created.text

    async def load():
        from finance_hub.db import Trigger
        async with app.state.db.sessions() as session:
            return await session.get(Trigger, created.json()["id"])
    return client.portal.call(load)


LOW_TRIAGE = {"urgency": 0, "adjustment": -15, "summary": "Bitcoin reached the level", "rationale": "Requested"}


def test_price_level_alerts_once_even_with_low_triage_and_stays_quiet_below(client, app, monkeypatch):
    calls = live_quotes(app, monkeypatch, 99999, LOW_TRIAGE)
    trigger = level_trigger(client, app)
    monkeypatch.setattr("finance_hub.market.market_open", lambda: False)  # Crypto ignores stock hours.
    client.portal.call(app.state.triggers.poll_trigger, trigger)
    assert client.get("/api/alerts?status=all").json() == [] and not calls
    live_quotes(app, monkeypatch, 100500, LOW_TRIAGE)
    for _ in range(3):
        client.portal.call(app.state.triggers.poll_trigger, trigger)
    alerts = client.get("/api/alerts?status=all").json()
    assert len(alerts) == 1 and alerts[0]["level"] == "Normal"


def test_price_level_spec_validation():
    from pydantic import ValidationError
    from finance_hub.schemas import SignalSpec
    good = {"source": "price", "query": "BINANCE:BTCUSDT", "detector": "price_level", "poll": "1m"}
    assert SignalSpec(**good, params={"level": 5, "direction": "below"})
    for params in ({"level": 0, "direction": "above"}, {"level": 5, "direction": "up"}, {"direction": "above"}):
        try:
            SignalSpec(**good, params=params)
        except ValidationError:
            continue
        raise AssertionError(params)


def test_trigger_list_includes_latest_price_only_for_price_alerts(client, app):
    from datetime import datetime, timedelta, timezone
    from finance_hub.db import Price
    level_trigger(client, app)
    create_watch(client)

    async def store():
        stamp = datetime.now(timezone.utc)
        async with app.state.db.sessions() as session:
            session.add_all([Price(ticker="BINANCE:BTCUSDT", ts=stamp - timedelta(minutes=1), price=70000.0),
                             Price(ticker="BINANCE:BTCUSDT", ts=stamp, price=75944.0)])
            await session.commit()
    client.portal.call(store)
    prices = {t["spec"]["name"]: t["latest_price"] for t in client.get("/api/triggers").json()}
    assert prices == {"Bitcoin reaches $100,000": 75944.0, "Watch": None}


def event_setup(client, app, monkeypatch, articles, happened=False, article_id="A1", deadline=None, tickers=()):
    from finance_hub.db import Trigger
    provider = app.state.providers
    verifications = []

    async def chat(role, system, payload, json_output=False):
        if role == "super":
            verifications.append(payload)
            return {"happened": happened, "article_id": article_id if happened else None, "reason": "test"}
        return LOW_TRIAGE

    async def general():
        return articles

    monkeypatch.setattr(provider.settings, "demo_mode", False)
    monkeypatch.setattr(provider, "chat", chat)
    monkeypatch.setattr(provider, "general_news", general)
    params = {"condition": "The Fed has cut interest rates.", "keywords": ["fed", "rates"],
              **({"deadline": deadline} if deadline else {})}
    spec = {"name": "Fed cuts", "entity": "Market event", "tickers": list(tickers), "hypothesis": "Requested",
            "signals": [{"source": "event", "query": "Fed cut", "detector": "event_occurs", "params": params, "poll": "10m"}]}
    created = client.post("/api/triggers", json={"spec": spec, "approved": True})
    assert created.status_code == 201, created.text

    async def load():
        async with app.state.db.sessions() as session:
            return await session.get(Trigger, created.json()["id"])

    async def poll():
        trigger = await load()
        trigger.next_polls = {k: v for k, v in trigger.next_polls.items() if k == "event"}
        await app.state.triggers.poll_trigger(trigger)
    return verifications, lambda: client.portal.call(poll)


FED = {"url": "https://a.example/fed", "title": "Fed cuts rates", "excerpt": "The Fed cut rates today.", "publisher": "Reuters"}
OTHER = {"url": "https://a.example/other", "title": "Second quarter sector results", "excerpt": "Nothing relevant.", "publisher": "X"}


def event_row(client):
    return client.get("/api/triggers").json()[0]


def test_event_alert_needs_verification_and_uses_whole_word_keywords(client, app, monkeypatch):
    verifications, poll = event_setup(client, app, monkeypatch, [FED, OTHER], happened=False)
    poll()
    assert [a["title"] for a in verifications[0]["articles"]] == ["Fed cuts rates"]
    assert client.get("/api/alerts?status=all").json() == []
    assert event_row(client)["event_state"] == {"checked": 2}
    poll()
    assert len(verifications) == 1  # Articles already judged aren't sent again.


def test_confirmed_event_alerts_once_despite_low_triage(client, app, monkeypatch):
    verifications, poll = event_setup(client, app, monkeypatch, [FED], happened=True)
    for _ in range(3):
        poll()
    alerts = client.get("/api/alerts?status=all").json()
    assert len(verifications) == 1 and len(alerts) == 1 and alerts[0]["level"] == "Normal"
    state = event_row(client)["event_state"]
    assert state["outcome"] == "happened" and state["url"] == FED["url"]


def test_yes_without_a_real_article_does_not_alert(client, app, monkeypatch):
    _, poll = event_setup(client, app, monkeypatch, [FED], happened=True, article_id="A99")
    poll()
    assert client.get("/api/alerts?status=all").json() == []
    assert "outcome" not in event_row(client)["event_state"]


def test_event_past_deadline_expires_without_checking(client, app, monkeypatch):
    verifications, poll = event_setup(client, app, monkeypatch, [FED], happened=True, deadline="2020-01-01")
    poll()
    assert not verifications and event_row(client)["event_state"]["outcome"] == "expired"
    assert client.get("/api/alerts?status=all").json() == []


def test_chat_drafts_market_wide_event_alert(client, app, monkeypatch):
    routed = {"intent": "new_alert", "tickers": [], "alert": {"symbol": None, "condition": "The Fed has cut interest rates.",
              "keywords": ["fed", "rate cut"], "deadline": "2020-01-01", "price": None}}
    live_quotes(app, monkeypatch, 75000.5, routed)
    response = client.post("/api/chat", json={"message": "Alert me if the Fed cuts rates"})
    assert not parse_sse(response, "error"), response.text
    spec = parse_sse(response, "trigger_approval")[0]["proposals"][0]["spec"]
    assert spec["tickers"] == [] and spec["signals"][0]["detector"] == "event_occurs"
    assert "deadline" not in spec["signals"][0]["params"]  # A past date is dropped.
    assert client.get("/api/triggers").json() == []


def test_only_event_triggers_may_omit_tickers():
    from pydantic import ValidationError
    from finance_hub.schemas import TriggerSpec
    try:
        TriggerSpec(name="x", entity="x", tickers=[], hypothesis="x", signals=[
            {"source": "news", "query": "x", "detector": "text_event"}])
    except ValidationError:
        return
    raise AssertionError("expected a validation error")


def test_event_condition_always_names_its_subject():
    from finance_hub.advisor import clean_alert_request
    named = clean_alert_request({"symbol": "AAPL", "name": "Apple", "condition": "announces a stock split"})
    assert named["condition"] == "Apple: announces a stock split"
    kept = clean_alert_request({"symbol": "AAPL", "name": "Apple", "condition": "Apple has announced a stock split."})
    assert kept["condition"] == "Apple has announced a stock split."
