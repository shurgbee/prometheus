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


@pytest.mark.asyncio
async def test_chat_stream_yields_content_and_skips_other_frames(app):
    frames = ['data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}', 'data: {"choices":[{"delta":{"content":"Hel"}}]}',
              ": keepalive", 'data: {"choices":[]}', 'data: {"choices":[{"delta":{"content":"lo"}}]}', "data: [DONE]"]
    seen = []

    async def handler(request):
        seen.append(request)
        return httpx.Response(200, text="\n\n".join(frames))
    provider = app.state.providers
    provider.settings.demo_mode = False
    await provider.http.aclose()
    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        assert [t async for t in provider.chat_stream("super", "system", {})] == ["Hel", "lo"]
        assert b'"stream":true' in seen[0].content.replace(b" ", b"")
    finally:
        provider.settings.demo_mode = True


@pytest.mark.asyncio
async def test_chat_stream_rejects_empty_output_and_errors(app):
    responses = iter([httpx.Response(200, text="data: [DONE]"), httpx.Response(401, text="nope")])

    async def handler(_):
        return next(responses)
    provider = app.state.providers
    provider.settings.demo_mode = False
    await provider.http.aclose()
    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        for _ in range(2):
            with pytest.raises(ProviderError):
                [t async for t in provider.chat_stream("super", "system", {})]
    finally:
        provider.settings.demo_mode = True


@pytest.mark.asyncio
async def test_structured_chat_tolerates_wrapped_json_and_retries_bad_replies(app):
    replies = iter(["not json at all", '```json\n{"intent": "triggers"}\n```', "nope", "still nope"])

    async def handler(_):
        return httpx.Response(200, json={"choices": [{"message": {"content": next(replies)}}]})
    provider = app.state.providers
    provider.settings.demo_mode = False
    await provider.http.aclose()
    provider.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        assert await provider.chat("nano", "system", {}, True) == {"intent": "triggers"}
        with pytest.raises(ProviderError):
            await provider.chat("nano", "system", {}, True)
    finally:
        provider.settings.demo_mode = True
