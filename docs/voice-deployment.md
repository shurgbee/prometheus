# Deployed calling service

Deployed and verified on 2026-11-08. Host: `controversial-tan-flea`, instance `h9yh186dv`, Hyperstack A100 80 GB. Deployment directory: `/home/shadeform/prometheus-voice`. This runbook supersedes the Riva-only recommendation in `calling-module-plan.md` for the current deployment.

## What runs

| Service | Purpose | Access |
| --- | --- | --- |
| Kokoro 0.9.4 / PyTorch 2.8.0 | GPU speech synthesis, `af_heart` English voice | VPS loopback `9000` |
| LiveKit Server 1.13.11 | Audio rooms | VPS loopback API `7880`; co-located RTC clients |
| LiveKit SIP | Outbound TLS trunk to Photon | Outbound `sip.photon.codes:5061`; public RTP UDP `10000–10100` |
| Redis | LiveKit/SIP coordination | VPS loopback `16379` |
| Python gateway | Persistent call attempts, WAV caching and playback | VPS loopback `8002`, notifier bearer token |
| TypeScript notifier | `/notify`, text/call routing, retries and backend callbacks | VPS loopback `8001`, notifier bearer token |

The phone-number/carrier connection remains Photon. Everything from script generation through speech inference, media handling and retry persistence runs on the VPS. No cloud TTS, conversational LLM, ASR, Retell or LiveKit Cloud is used for calls. [LiveKit SIP self-hosting](https://docs.livekit.io/transport/self-hosting/sip-server/), [Kokoro model and license](https://huggingface.co/hexgrad/Kokoro-82M).

Nano was already stopped and the GPU idle. Its unused `vllm/vllm-openai:v0.12.0` Docker image was removed to recover root-disk capacity; model/workspace files and the old checkout were retained. The first Riva image pull ran out of root-disk space; after removing that unused image the pull succeeded.

Riva's image remains downloaded and pinned, but its model download rejected the available credential. You selected Kokoro instead. Riva is stopped and excluded by the default `kokoro` Compose profile. Kokoro occupies about 1.1 GB GPU memory in the verified idle state.

## Verified behavior and remaining restriction

- One real call from the Photon number ending `8061` to the configured separate recipient connected. The entire announcement completed, and you confirmed the audio was clear.
- A seven-second announcement rendered through the gateway in 0.24 seconds; a separate tunnel-based check rendered 4.78 seconds of speech in 0.41 seconds. These are warm single-request measurements, not load-test guarantees.
- LiveKit's outbound trunk is `ST_XkGpj8m3vvgH`. Photon TLS negotiation succeeded with TLS 1.3. The number uses its generated v2 Voice-profile credentials, not the REST key or Spectrum project secret. [Photon v2 connection guide](https://photon.codes/docs/beta/cookbooks/voice/livekit).
- Photon rejected the detail SMS with `SMS_CAMPAIGN_NOT_ELIGIBLE`. A read-only campaign-assignment check returned `campaign: null`, `eligibility: blocked`, `reasonCode: SMS_CAMPAIGN_NOT_ASSIGNED`. Organization campaign listing returned HTTP 403 with the project key. An organization administrator must assign an eligible campaign to this line in Photon, registering/completing approval if needed; this deployment does not invent registration details or bypass that requirement. The test journal correctly records `voiceOutcome=completed` and overall `status=failed` because the required detail text failed.
- After container recreation, replaying `voice-setup-20261108-1` returned `duplicate: true` and the existing completed call. It did not dial again. The SSH tunnel is running; the local backend was not running at the final check, so start it with `scripts/dev.py --no-notifier` for callbacks and dashboard cancellation checks.
- Missed-call retry, dashboard acknowledgement cancellation, crash recovery and concurrent-text behavior are covered by deterministic tests. Only the answered-call path was tested against a real phone.

## Private configuration

Local `.env.voice` and remote `.env` contain generated credentials and must remain private. They are excluded from Git and Docker build contexts. Keep a secure backup of the SIP password: Photon does not reveal an existing password on ordinary GET requests.

`ALERT_PHONE` is the call recipient in E.164 format. `ALERT_TEXT_RECIPIENT` optionally selects a separate message destination, such as the Apple ID email assigned to a shared iMessage line. It defaults to the alert's phone. Normal alerts, call details and fallback messages all use this destination; accepted deliveries persist it so configuration changes cannot redirect retries.

For iMessage plus voice, use `PHOTON_PLATFORM=imessage` and `PHOTON_LINE` for the iMessage sender, and `VOICE_PHOTON_LINE` for the voice caller ID. The shared iMessage recipient must have an active assignment and have messaged the line first. SMS campaigns are only relevant when selecting the SMS messaging channel. The voice gateway keeps its separate SIP configuration. The configuration script preserves both senders in `.env.voice`; legacy voice deployments fall back to `PHOTON_LINE` when `VOICE_PHOTON_LINE` is absent.

For the local app, run a local notifier on an unused port (currently `NOTIFIER_URL=http://127.0.0.1:8003`) and set `VOICE_GATEWAY_URL=http://127.0.0.1:8002`. The SSH tunnel below forwards the voice gateway to the VPS. Alternatively, use the VPS notifier through forwarded port 8001 after deploying the same messaging configuration. The VPS sends backend callbacks to `http://127.0.0.1:18000`, reverse-forwarded to the workstation's backend port 8000.

The local app reads `DATABASE_URL` from this checkout's root `.env`. A URL saved only in `/home/shadeform/prometheus/.env` on the VPS does not configure the local app. Tiger's URL must include its database password, for example `postgresql://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require`; percent-encode special characters in the password. The development launcher now checks connectivity before starting children and reports a single actionable login error without printing the connection string.

## Reproduce from this checkout

Prerequisites: an existing Brev SSH alias, Docker Compose and working NVIDIA Container Toolkit on the host. Allow at least 60 GB free root-disk space for image extraction/builds plus a separate model cache; the supplied A100 host has a large `/ephemeral` disk. The bootstrap keeps control APIs private and opens only the configured call media range in UFW. The cloud/provider firewall must also permit that media traffic.

1. Put the existing Photon v2 project ID/key, notifier token and recipients in local `.env`. The key needs Users, Spaces, Messages and Platforms read/write permissions. Select the messaging platform and sender separately from `VOICE_PHOTON_LINE`. Configure an SMS campaign only if using the SMS messaging channel.

2. Generate/reuse the private Voice settings on the workstation:

   ```sh
   .venv/bin/python scripts/configure-voice.py
   ```

   This enables outbound SIP only if absent, saves its returned password, and never silently rotates existing credentials. If there are several eligible voice lines, set `VOICE_PHOTON_LINE` explicitly. The default is `COMPOSE_PROFILES=kokoro`. On a fresh workstation with outbound already enabled, restore the existing `.env.voice` backup or supply its SIP password before rerunning; do not rotate credentials unnecessarily.

3. Upload/build/start from the workstation:

   ```sh
   .venv/bin/python scripts/deploy-voice.py controversial-tan-flea
   ```

   On a fresh host, perform the one-time cache/firewall/socket-buffer preparation after upload:

   ```sh
   ssh controversial-tan-flea
   cd /home/shadeform/prometheus-voice
   bash infra/voice/bootstrap.sh
   ```

   The deploy script uses encrypted SSH stdin to upload an archive with the private settings; secrets are not put in command arguments or printed. It does not overwrite `/home/shadeform/prometheus`. Images are pinned in `infra/voice/images.lock.json`, Docker base images by digest, Node packages by `package-lock.json`, and primary Python dependencies by version. The English language pack is installed in the image. The first Kokoro start downloads public voice/model weights into the mounted cache; deployment then waits for gateway/TTS readiness and GPU warm-up.

4. Connect the local application:

   ```sh
   bash scripts/voice-tunnel.sh
   uv run python scripts/dev.py
   ```

   Install the app's usual frontend/backend dependencies first if needed. This starts the local notifier using the root `.env`. If choosing the remote notifier on forwarded port 8001 instead, pass `--no-notifier`. Keep `DEMO_MODE=false` for real delivery. The backend code in this checkout includes the notifier-authenticated retry-state endpoint; an older backend will not support cancellation checks. The tunnel reconnects the transport, not the app; it does not start the frontend/backend or worker.

5. Check speech and optionally place a call:

   ```sh
   .venv/bin/python scripts/voice-smoke.py
   .venv/bin/python scripts/voice-smoke.py --call
   ```

   `--call` creates a real phone call to `ALERT_PHONE` and sends details to `ALERT_TEXT_RECIPIENT` (or the phone when unset) through the selected messaging channel. It uses the root `.env`'s `NOTIFIER_URL`, defaulting to forwarded port 8001. It explicitly sets `test_call: true`, so it does not consume or enforce the daily alert-call allowance. A new ID creates a new test alert. To verify duplicate handling without another call, reuse the completed test ID:

   ```sh
   .venv/bin/python scripts/voice-smoke.py --call --alert-id voice-setup-20261108-1
   ```

   Stop the workstation tunnel with `bash scripts/voice-tunnel.sh close`. It must be reopened after a workstation reboot or a dropped SSH session. If Brev changes the host's public IP after a restart, rerun deployment/preparation so SIP advertises the current address.

## Operations and persistence

Run on the VPS:

```sh
cd /home/shadeform/prometheus-voice
docker compose --env-file .env -f infra/voice/compose.yml ps
docker compose --env-file .env -f infra/voice/compose.yml logs --tail 50 gateway notifier kokoro sip
docker compose --env-file .env -f infra/voice/compose.yml restart gateway notifier
```

Containers have `restart: unless-stopped`. Redis, gateway SQLite/WAVs and the notifier journal are bind-mounted under `infra/voice/data`; do not delete that directory to fix a failed call. It contains dedupe records and the daily physical-call ledger. Model caches live at `/ephemeral/prometheus-kokoro-cache` and `/ephemeral/prometheus-voice-cache`. Back up credentials and state before deleting an instance.

The gateway defaults to at most three production dial attempts per day in `America/Chicago`, including production retries. Explicit test calls are excluded and remain recorded in the journal. The authenticated `/notify` and `/calls` APIs accept the boolean `test_call: true`; omitting it counts the call normally. The flag persists across restarts and retries, and cannot change for an existing gateway key. New calls are never classified by their ID prefix. Calls only go to the configured recipient. The notifier honors `channel=text` even for Critical alerts, persists a missed-call retry after two minutes, checks ack/snooze/trigger state before retrying, and retains an uncertain call's existing key. A gateway restart cancels uncertain rooms rather than initiating another call. DTMF acknowledgement is not implemented; use the dashboard.

Gateway `/healthz` reports the durable production `call_budget` (`used`, `limit`, `remaining`, `resets_at`, `timezone`) plus the separately counted `test_calls`. Its `ok` flag checks TTS and LiveKit, and does not establish that the carrier will accept an outbound call. An exhausted production budget is rejected before opening media sessions, with an atomic second check at dial time. Smoke tests remain available when production allowance is exhausted. Failed, missed and interrupted calls return a nonzero process exit status.

### Follow-up diagnosis on 2026-11-08

The initial answered test was followed by two outbound SIP 403 rejections, at approximately 09:51 and 09:59 UTC. Originally these test calls consumed all three reservations for November 8 in Chicago. Later `RuntimeError` failures had no dial reservation; they were the daily limit being hidden by the original generic error handler. The updated gateway exposes the actual limit error. At your request, test calls were subsequently exempted; the five known existing setup/smoke journal rows were explicitly reclassified as tests, preserving all outcomes and dial timestamps. Those three test reservations now consume no production allowance.

Photon still reports an active voice-capable line, the same default profile, and an unchanged SHA-256 outbound credential. LiveKit's trunk matches the configured endpoint, caller number, username and saved password. The SIP logs show a 407 challenge followed by Photon returning 403 Forbidden. The available developer logs do not supply a more specific SIP denial reason. Carrier acceptance remains unresolved; do not treat the limit reset as a fix for the 403. Photon support/account diagnostics may be needed. Useful SIP Call-IDs are `nUMJefeNmGLcwoYhA6ei8aaF7ivC` (09:59 UTC) and LiveKit call ID `SCL_XGGKsGHhHS87`. No additional call attempts or credential rotations were used during this diagnosis.

An unavailable local backend postpones physical missed-call retries until acknowledgement state can be checked. Delivery callbacks are retried independently. The dashboard URL is still the existing local URL; set `DASHBOARD_URL` to a phone-reachable URL before expecting detail links to open on a phone, regenerate private settings and redeploy.

## Switch to Riva later

Obtain a model-enabled NGC key and add `NGC_API_KEY` to local `.env`. Change `COMPOSE_PROFILES` in `.env.voice` to `riva`, run the configuration script again, stop Kokoro on the VPS to free port 9000, and redeploy:

```sh
.venv/bin/python scripts/configure-voice.py
ssh controversial-tan-flea 'docker stop prometheus-voice-kokoro-1'
.venv/bin/python scripts/deploy-voice.py
```

Wait for Riva readiness before testing. Its first model download/engine initialization can take up to 30 minutes. The gateway normalizes either engine's WAV to mono 48 kHz PCM before publishing it to LiveKit. [NVIDIA Riva setup](https://docs.nvidia.com/nim/speech/latest/get-started/tutorials/tts.html).

## Validation

```sh
npm run typecheck --prefix notifier
npm test --prefix notifier
.venv/bin/python -m pytest -q
.venv/bin/ruff check backend tests infra/voice scripts/configure-voice.py scripts/deploy-voice.py scripts/voice-smoke.py
```

Isolated gateway regressions can run inside the deployed image, using temporary SQLite databases and mocked media/provider clients:

```sh
ssh controversial-tan-flea 'cd /home/shadeform/prometheus-voice && docker compose --env-file .env -f infra/voice/compose.yml run --rm --no-deps -v "$PWD/infra/voice/test_gateway.py:/app/test_gateway.py:ro" -e VOICE_DATA=/tmp/gateway-tests gateway python -m unittest test_gateway -v'
```

The research plan is in `docs/calling-module-plan.md`; this document records the actual deployment, selected Kokoro substitution, verified phone result and outstanding SMS restriction.
