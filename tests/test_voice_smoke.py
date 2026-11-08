"""Exercise the real CLI with HTTP fixtures; never dial during tests."""
import io
import json
from pathlib import Path
import runpy
import sys
import wave

import httpx
import pytest


@pytest.mark.parametrize("status", ["failed", "missed", "interrupted", "completed"])
def test_call_smoke_process_reports_actual_call_outcome(monkeypatch, status):
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(48000)
        wav.writeframes(b"\0\0" * 480)

    def handle(request):
        path = request.url.path
        if path == "/healthz":
            return httpx.Response(200, json={"ok": True, "tts": True, "livekit": True, "call_budget": {
                "used": 3, "limit": 3, "remaining": 0, "resets_at": "2026-11-09T00:00:00-06:00"}})
        if path == "/health":
            return httpx.Response(200, json={"ok": True})
        if path == "/render":
            return httpx.Response(200, content=audio.getvalue())
        if path == "/notify":
            assert json.loads(request.content)["test_call"] is True
            return httpx.Response(202, json={"status": "queued", "duplicate": True})
        if path.startswith("/calls/"):
            return httpx.Response(200, json={"status": status, "error": "Daily physical-call limit reached"})
        raise AssertionError(path)

    original = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr("dotenv.dotenv_values", lambda _: {
        "NOTIFIER_TOKEN": "test-only-token", "ALERT_PHONE": "+12025550123"})
    monkeypatch.setattr(sys, "argv", ["voice-smoke.py", "--call", "--alert-id", "existing-test"])
    def run():
        runpy.run_path(str(Path(__file__).parents[1] / "scripts/voice-smoke.py"), run_name="__main__")
    if status == "completed":
        run()
    else:
        with pytest.raises(SystemExit) as error:
            run()
        assert error.value.code != 0
