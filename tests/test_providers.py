import httpx
import pytest

from finance_hub.providers import ProviderError


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
