"""Fail deployment unless the private voice gateway and TTS become ready."""
import json
from pathlib import Path
import shlex
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[2]
settings = {}
for line in (root / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        settings[key] = shlex.split(value)[0] if value else ""
request = urllib.request.Request("http://127.0.0.1:8002/healthz",
                                headers={"Authorization": "Bearer " + settings["NOTIFIER_TOKEN"]})
deadline = time.monotonic() + 180
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            health = json.load(response)
        if health.get("ok"):
            print("Voice dependencies ready:", health)
            break
    except (urllib.error.URLError, TimeoutError):
        pass
    time.sleep(3)
else:
    raise SystemExit("Voice dependencies did not become ready. Inspect gateway/TTS container logs.")
