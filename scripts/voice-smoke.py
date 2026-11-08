"""Check the deployed voice stack via scripts/voice-tunnel.sh; --call places a real call."""
import argparse
import io
from pathlib import Path
import time
from uuid import uuid4
import wave

from dotenv import dotenv_values
import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--call", action="store_true", help="Call ALERT_PHONE and attempt a real detail SMS")
parser.add_argument("--alert-id", help="Reuse an ID to check notifier idempotency without another call")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
config = dotenv_values(root / ".env.voice")
headers = {"Authorization": "Bearer " + config["NOTIFIER_TOKEN"]}
with httpx.Client(timeout=45, headers=headers) as client:
    health = client.get("http://127.0.0.1:8002/healthz")
    health.raise_for_status()
    health_state = health.json()
    print("Voice health:", health_state)
    if not health_state["ok"]:
        raise SystemExit("Voice dependencies are not ready")
    try:
        backend = client.get("http://127.0.0.1:8000/health", timeout=3)
        print("Local backend:", backend.json() if backend.is_success else backend.status_code)
    except httpx.HTTPError:
        print("Local backend is not running; start scripts/dev.py --no-notifier for callbacks and retry cancellation.")
    start = time.monotonic()
    response = client.post("http://127.0.0.1:8002/render", json={
        "script": "This is a Finance Hub test. Your self hosted calling service is ready."})
    response.raise_for_status()
    with wave.open(io.BytesIO(response.content)) as audio:
        print("Rendered", round(audio.getnframes() / audio.getframerate(), 2),
              "seconds of speech in", round(time.monotonic() - start, 2), "seconds")
    if args.call:
        alert_id = args.alert_id or "voice-smoke-" + str(uuid4())
        payload = {"alert_id": alert_id, "level": "Critical", "phone": config["ALERT_PHONE"],
            "title": "Voice service test", "summary": "This is a test. Your self hosted calling service is ready. "
            "No financial event triggered this alert.", "url": config.get("DASHBOARD_URL", ""),
            "channel": "call", "severity": 80, "test_call": True}
        response = client.post("http://127.0.0.1:8001/notify", json=payload,
                               headers={"Idempotency-Key": alert_id})
        response.raise_for_status()
        print("Notifier:", response.json())
        previous = None
        for _ in range(180):
            response = client.get(f"http://127.0.0.1:8002/calls/{alert_id}:call:1")
            if response.is_success:
                state = response.json()
                if state["status"] != previous:
                    print("Call:", state, flush=True)
                    previous = state["status"]
                if state["status"] in {"completed", "missed", "failed", "interrupted"}:
                    if state["status"] != "completed":
                        raise SystemExit(f"Call did not complete: {state['status']}: {state.get('error') or 'no error detail'}")
                    break
            time.sleep(1)
        else:
            raise SystemExit("Call outcome remains pending; inspect the VPS journal before retrying")
