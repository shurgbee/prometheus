import httpx
import pytest

from finance_hub.config import Settings
from finance_hub.providers import ProviderError, Providers


@pytest.mark.asyncio
async def test_hosted_models_share_one_endpoint_and_key():
    import json

    settings = Settings(_env_file=None, demo_mode=False, api_token="long-test-api-token",
        database_url="postgresql://unused:unused@localhost/unused", finnhub_api_key="unused",
        notifier_url="http://localhost:8001", notifier_token="unused", alert_phone="+15555550123",
        nvidia_api_key="shared-test-key", nvidia_base_url="https://hosted.example/v1",
        super_base_url="", nano_base_url="", embed_base_url="", super_api_key="", nano_api_key="",
        embed_api_key="", embed_dimensions=8)
    requests = []

    async def hosted(request):
        requests.append(request)
        if request.url.path.endswith("/embeddings"):
            return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5] * 8}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok":true}'}}]})

    provider = Providers(settings, db=None)
    await provider.http.aclose()
    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(hosted))
    try:
        assert await provider.chat("super", "Test", {}, json_output=True) == {"ok": True}
        assert await provider.chat("nano", "Test", {}, json_output=True) == {"ok": True}
        assert len((await provider.embed(["Test passage"]))[0]) == 8
        assert [str(r.url) for r in requests] == ["https://hosted.example/v1/chat/completions",
            "https://hosted.example/v1/chat/completions", "https://hosted.example/v1/embeddings"]
        assert {r.headers["Authorization"] for r in requests} == {"Bearer shared-test-key"}
        assert [json.loads(r.content)["model"] for r in requests] == [settings.super_model,
            settings.nano_model, settings.embed_model]
    finally:
        await provider.close()


@pytest.mark.asyncio
async def test_demo_never_uses_network(app):
    async def forbidden(_):
        raise AssertionError("Demo mode attempted an external request")
    provider = app.state.providers
    await provider.http.aclose()
    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(forbidden))
    await app.state.db.initialize()
    try:
        assert (await provider.quote("TSLA"))["demo"]
        assert (await provider.news(["TSLA"]))[0]["title"].startswith("DEMO")
        assert len((await provider.embed(["EV subsidies"]))[0]) == 32
    finally:
        await provider.close()
        await app.state.db.close()


@pytest.mark.asyncio
async def test_live_auth_errors_do_not_leak_keys(app):
    provider = app.state.providers
    secret = "a-secret-key-that-must-not-leak"
    async def unauthorized(request):
        return httpx.Response(401, json={"error": secret}, request=request)
    await provider.http.aclose()
    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(unauthorized))
    try:
        with pytest.raises(ProviderError) as error:
            await provider._request("GET", f"https://example.test/?token={secret}")
        assert secret not in str(error.value)
        assert "401" in str(error.value)
    finally:
        await provider.close()
