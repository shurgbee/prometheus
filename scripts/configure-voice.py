"""Configure Photon v2 outbound SIP and write private deployment settings.

Run with the backend virtualenv: .venv/bin/python scripts/configure-voice.py
Never prints credentials. Existing outbound passwords are never rotated implicitly.
"""
import json
import os
from pathlib import Path
import secrets

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / ".env.voice"
config = {**dotenv_values(ROOT / ".env"), **os.environ}
saved = dotenv_values(path) if path.exists() else {}
headers = {"Authorization": "Bearer " + config["PHOTON_API_KEY"], "User-Agent": "prometheus-voice/1.0"}
if not config.get("NOTIFIER_TOKEN") or len(config["NOTIFIER_TOKEN"]) < 16:
    raise RuntimeError("Set NOTIFIER_TOKEN to at least 16 characters before configuring providers")


def check(response):
    if not response.is_success:
        data = response.json()
        raise RuntimeError(f"Photon HTTP {response.status_code}: {data.get('code')} {data.get('detail', '')}")
    return response.json()


with httpx.Client(base_url="https://api.photon.codes/v1/projects/" + config["PHOTON_PROJECT_ID"],
                  headers=headers, timeout=30) as client:
    resources = check(client.get("/platforms/resources", params={"pageSize": 100}))["resources"]
    lines = [r for r in resources if "pstn_voice" in r["abilities"] and "sms" in r["abilities"]]
    selected = (config.get("VOICE_PHOTON_LINE") or saved.get("VOICE_PHOTON_LINE")
                or saved.get("PHOTON_LINE") or config.get("PHOTON_LINE"))
    if selected:
        lines = [r for r in lines if r["detail"].get("phoneNumber") == selected]
    if len(lines) != 1:
        raise RuntimeError("Set VOICE_PHOTON_LINE to select exactly one voice line")
    line = lines[0]
    sender = check(client.post("/users", json={"platform": "sms", "handle": line["detail"]["phoneNumber"]}))
    if sender.get("kind") != "agent":
        raise RuntimeError("The selected line did not resolve to an SMS agent identity")
    assignment = check(client.get(f"/platforms/voice/lines/{line['resourceId']}/profile"))
    profile_path = (f"/platforms/voice/profiles/{assignment['profileId']}" if assignment.get("profileId")
                    else "/platforms/voice/profiles/default")
    response = client.get(profile_path)
    if response.status_code == 404 and profile_path.endswith("/default"):
        profile = check(client.put(profile_path, json={"protocol": "sip", "mediaEncryption": "auto"},
                                   headers={"Idempotency-Key": "prometheus-default-voice-v1"}))
    else:
        profile = check(response)
    outbound = profile["configuration"]["outbound"]
    password = saved.get("PHOTON_SIP_PASSWORD")
    if outbound is None:
        result = check(client.put(f"/platforms/voice/profiles/{profile['profileId']}/outbound",
                                  json={"expectedVersion": profile["version"],
                                        "authentication": {"algorithm": "sha-256"}},
                                  headers={"Idempotency-Key": "prometheus-outbound-voice-v1"}))
        outbound, password = result["outbound"], result["password"]
    elif not password or saved.get("PHOTON_VOICE_PROFILE_ID") != profile["profileId"]:
        raise RuntimeError("Outbound SIP is already enabled; supply its password in .env.voice. No credentials rotated.")
    endpoints = [e for e in outbound["connection"]["endpoints"] if e["transport"] == "tls"]
    if not endpoints:
        raise RuntimeError("Photon profile has no TLS connection")
    endpoint = endpoints[0]

text_platform = config.get("PHOTON_PLATFORM") or "imessage"
text_line = config.get("PHOTON_LINE") or (line["detail"]["phoneNumber"] if text_platform == "sms" else "")
text_sender = config.get("PHOTON_SENDER_ID") or (
    sender["id"] if text_platform == "sms" and text_line == line["detail"]["phoneNumber"] else "")
settings = {
    **saved,
    "PHOTON_PROJECT_ID": config["PHOTON_PROJECT_ID"], "PHOTON_API_KEY": config["PHOTON_API_KEY"],
    "PHOTON_PLATFORM": text_platform, "PHOTON_LINE": text_line,
    "PHOTON_SENDER_ID": text_sender,
    "ALERT_TEXT_RECIPIENT": config.get("ALERT_TEXT_RECIPIENT") or "",
    "VOICE_PHOTON_LINE": line["detail"]["phoneNumber"],
    "PHOTON_VOICE_PROFILE_ID": profile["profileId"],
    "PHOTON_SIP_ADDRESS": f"{endpoint['host']}:{endpoint['port']}",
    "PHOTON_SIP_USERNAME": outbound["authentication"]["username"], "PHOTON_SIP_PASSWORD": password,
    "NOTIFIER_TOKEN": config["NOTIFIER_TOKEN"], "ALERT_PHONE": config["ALERT_PHONE"],
    "DASHBOARD_URL": config.get("DASHBOARD_URL", "http://localhost:3000"),
    "LIVEKIT_API_KEY": saved.get("LIVEKIT_API_KEY") or "prometheus" + secrets.token_hex(6),
    "LIVEKIT_API_SECRET": saved.get("LIVEKIT_API_SECRET") or secrets.token_hex(32),
    "NGC_API_KEY": config.get("NGC_API_KEY") or saved.get("NGC_API_KEY") or config.get("NVIDIA_API_KEY", ""),
    "NOTIFIER_BACKEND_URL": saved.get("NOTIFIER_BACKEND_URL") or "http://127.0.0.1:18000",
    "VOICE_RETRY_DELAY_MS": saved.get("VOICE_RETRY_DELAY_MS") or "120000",
    "COMPOSE_PROFILES": saved.get("COMPOSE_PROFILES") or "kokoro",
}
if not settings["NOTIFIER_TOKEN"] or len(settings["NOTIFIER_TOKEN"]) < 16:
    raise RuntimeError("Set NOTIFIER_TOKEN to at least 16 characters")
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as file:
    file.write("# Private generated voice deployment settings. Do not commit.\n")
    for key, value in settings.items():
        file.write(f"{key}={json.dumps(value)}\n")
print("Configured Photon outbound SIP; wrote .env.voice (credentials not printed).")
print("Caller ID ends in", settings["VOICE_PHOTON_LINE"][-4:], "recipient ends in", settings["ALERT_PHONE"][-4:])
