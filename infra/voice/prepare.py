"""Run on the VPS before docker compose; generate private LiveKit config and pin images."""
import json
from pathlib import Path
import shlex
import subprocess

root = Path(__file__).resolve().parents[2]
env_path = root / ".env"
settings = {}
for line in env_path.read_text().splitlines():
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    parts = shlex.split(value)
    settings[key] = parts[0] if parts else ""
public_ip = subprocess.check_output(["curl", "-fsS", "--max-time", "15", "https://api.ipify.org"], text=True).strip()
settings["PUBLIC_IP"] = public_ip
images = json.loads((root / "infra/voice/images.lock.json").read_text())
settings.update(images)
env_path.write_text("\n".join(f"{k}={json.dumps(v)}" for k, v in settings.items()) + "\n")
env_path.chmod(0o600)
runtime = root / "infra/voice/runtime"
runtime.mkdir(parents=True, exist_ok=True)
config = {"port": 7880, "bind_addresses": ["127.0.0.1"],
          "rtc": {"tcp_port": 7881, "udp_port": 7882, "use_external_ip": False},
          "redis": {"address": "127.0.0.1:16379"},
          "keys": {settings["LIVEKIT_API_KEY"]: settings["LIVEKIT_API_SECRET"]},
          "logging": {"level": "info"}}
target = runtime / "livekit.yaml"
target.write_text(json.dumps(config, indent=2))
target.chmod(0o600)
print("Prepared private LiveKit config; pinned container image digests; public media IP", public_ip)
