# Prometheus backend

FastAPI and a separate durable worker implement Dev A's reduced hackathon MVP in [SPEC.md](SPEC.md). The Next.js frontend in `finhub/` is integrated through a same-origin server proxy. The TypeScript Photon/LiveKit/Riva notifier remains a separate service. No trades are executed.

## Run the integrated app

With the root `.env` configured for demo mode (copy `.env.example` only if `.env` does not exist):

```sh
uv sync --python 3.13 --extra dev
cd finhub
npm ci
cd ..
uv run python scripts/dev.py --seed
```

Open **http://127.0.0.1:3000**. The launcher starts FastAPI, the worker and Next.js, shares the backend
bearer token with the Next.js server only, and stops the processes together on Ctrl-C. `--seed` loads
optional fixtures only into an empty demo portfolio; omit it for an existing database. The frontend
uses the real backend by default, including when that backend supplies labelled synthetic data.
See [the frontend README](finhub/README.md) for manual startup and [the integrated contract](finhub/API_CONTRACT.md)
for read models, percentage units, total position cost, approval edits and persisted chat recovery.

This launcher binds the single-user app to loopback. Public deployments must protect access to the
Next.js app; the server-to-server bearer token alone does not authenticate visitors to the frontend.

## Run locally

Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/) are required.

```sh
cp .env.example .env
UV_CACHE_DIR=/tmp/prometheus-uv uv sync --python 3.13 --extra dev
uv run finance-seed examples/demo-seed.json
uv run uvicorn finance_hub.api:create_app --factory --host 127.0.0.1 --port 8000
```

In another terminal from this directory:

```sh
uv run finance-worker
```

Use `Authorization: Bearer local-demo-token-change-me` for `/api/*`. Interactive API documentation is at `http://localhost:8000/docs` (click Authorize). `/health` is public and reports whether demo mode is active. The frontend origin defaults to `http://localhost:3000`. API and worker read the same `.env` and database.

**Demo mode uses synthetic prices, responses, research, and hash-based test embeddings. It makes no external requests and never texts or calls anyone.** Alerts end with `delivery_status=demo_recorded`, not a pretend delivery receipt. This is a test fixture, not market research. Live mode never silently substitutes fixtures for failed providers. The sample seed is optional smoke-test content; the presentation team can replace it with their seed file, reports and 30 days of snapshots. Seeding refuses to duplicate existing holdings.

Run one API process (`--workers 1`) and one worker. Per-thread locks protect checkpoint resumes inside the API; multi-process API replicas are outside this single-user MVP. The worker enforces singleton execution using a Postgres advisory lock or a local file lock for SQLite. Research, polling, snapshots and delivery have independent asynchronous loops, so report generation does not block an injected critical alert.

## Implemented scope

- Cash, CDs and stocks, validated CRUD and atomic CSV import with per-row errors; portfolio totals, ticker weights, gain/loss, allocation and CD ladder fields. `cost_basis` is the total position cost; cash uses `principal` as its balance; APY is a fraction (`0.045` means 4.5%). CDs stop accruing at maturity. Unpriced holdings make totals incomplete rather than silently adding zero.
- Finnhub quotes and company-news adapters with caching, timeouts, bounded retries and rate pacing. Stored quotes include exchange time, fetch time, previous close and daily change. Worker refreshes held/watched tickers during the XNYS calendar's market hours, including holidays/early closes. Portfolio load can fetch missing or stale quotes outside those hours.
- Nemotron Nano router and Super advisor through configurable OpenAI-compatible endpoints. Grounding tool context is returned with the chat stream. Facts must cite supplied news URLs, unsupported citations fail closed, a conservative post-check flags unknown numeric tokens, and every answer ends with the educational disclaimer. These are MVP checks, not a proof that a model's interpretation is correct.
- A LangGraph advisor with durable SQLite or Postgres checkpoints; approval/edit/reject interrupt before trigger writes; stable approval keys for replay safety. Research requests are idempotent within a graph turn. A follow-up research request can reuse the previous turn's ticker context.
- Background research over up to 25 Finnhub news abstracts: one Super synthesis call, fixed report sections, citation checks, short source excerpts, approximately 800-token chunks, summary/chunk embeddings, top-three vector search and up to three other similar reports. A durable `research_job` SSE event includes `thread_id` and report ID on completion.
- One-minute daily-change detector (default 3%) and five-minute headline keyword detector. Every due check produces an evaluation; only fired detectors call Nano triage. Exact external-event replay dedupe, configurable flat cooldown (default 30 minutes), snooze suppression and persisted rationale/evidence.
- Severity formula and 40/75 bands from the spec. Model adjustments are clamped to ±15; critical requires sufficient magnitude, `critical_capable`, and normalized exposure or a pinned watch. The formula defines `E=min(portfolio_fraction/0.10,1)`, so the spec's hard `E >= .05` corresponds to **0.5% of net worth**. Scores stay visible even when the hard gate caps the level to Normal.
- Durable alert outbox with three bounded HTTP attempts, idempotency key, delivery callbacks, acknowledgement and one call reservation per five minutes. Further critical alerts request text delivery. Call attempts/answer detection/TTS and missed-call retries belong to the notifier.
- Reconnectable database-backed SSE events shared across API and worker, and a dev-only injection route through the same evidence/scoring/cooldown/outbox path.

The spec explicitly cuts these from the two-hour backend build: Alpaca bars and z-scores; SEC/FRED/NYT/Federal Register/NHTSA fetchers; Steel research; research planning/extraction/critique graphs; BM25/RRF/reranking; embedding-based event dedupe; quiet-hours digests and three-calls-per-day rules. The flat cooldown and five-minute call guard implement its stated replacements. Report completion is announced through SSE/status polling; presence tracking and away-user report texts are deferred. Photon inbound replies and dashboard-to-notifier cancellation of a call already accepted by the notifier also need the alerts service. Ack/snooze stop backend retries but cannot retract a request already in flight.

## Frontend contract

All JSON and SSE routes are documented by OpenAPI. Monetary values are numbers rounded to cents. Portfolio weights are fractions. Timestamps are UTC ISO strings. Prices and report fixtures carry `demo` flags. Trigger payloads store the validated `TriggerSpec` under `spec`; holdings responses flatten their asset fields.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/portfolio` | Total, allocation, holdings, day change, completeness and stale-data indicators |
| POST/PATCH/DELETE | `/api/holdings[/{id}]` | Holding CRUD; PATCH merges provided fields then validates |
| POST | `/api/holdings/import` | Multipart `file`; max 1 MB/1000 rows; whole file rejected if any row fails |
| GET | `/api/networth/history?range=1M` | Daily snapshots; `1M`, `3M`, `1Y`, `All` |
| POST | `/api/chat` | SSE; JSON `{message, thread_id?}` |
| GET | `/api/chat/{thread_id}` | Persisted history, pending cards, and retry state (for reconnect/reload) |
| POST | `/api/chat/{thread_id}/retry` | Resume a failed turn from its last completed graph node |
| POST | `/api/chat/{thread_id}/resume` | SSE; `{decisions:[{proposal_id,action,spec?}]}` |
| GET/POST/PATCH/DELETE | `/api/triggers[/{id}]` | Explicit approval required for POST/PATCH |
| GET | `/api/triggers/{id}/evaluations?since=...` | Severity audit/sparkline, newest 500 by default returned chronologically |
| GET | `/api/alerts?status=open` | `open`, `acked`, or `all`, newest first |
| POST | `/api/alerts/{id}/ack` | Acknowledge and stop backend retry |
| POST | `/api/alerts/{id}/snooze?duration=24h` | Suppress further alerts for this trigger; max 30 days |
| GET | `/api/events?after=0` | Persistent event SSE; also accepts `Last-Event-ID` |
| POST | `/api/research` | 202 `{topic,questions?,tickers?,thread_id?}` → queued job |
| GET | `/api/research/{job_id}` | `queued`, `running`, `completed` with `report_id`, or `failed` |
| GET | `/api/reports?q=EV%20subsidies` | `{matches:[...passage,score],similar:[...]}`; omit `q` to list recent reports |
| GET | `/api/reports/{id}` | Markdown, sources, suggested triggers, similar reports |
| POST | `/api/dev/inject-signal` | Requires bearer auth **and** `ENABLE_DEV_INJECTION=true` |

Chat SSE events: `thread` (save its ID), `intent`, `tool` (turn context), `token` (`{text}`), `answer`, `trigger_approval` (`{proposals}`), `triggers_updated`, `done`, `error`. Model responses are buffered for grounding checks and then emitted in chunks; these are not native model-token streaming. Heartbeats keep slow model requests alive. Use `fetch` streaming for POST SSE and for authenticated dashboard SSE; browser `EventSource` cannot set a bearer header. Do not put API tokens into query strings or commit them into frontend source.

Resume must contain exactly one decision per pending card. `approve` uses the draft, `edit` supplies a complete validated `spec`, and `reject` writes nothing. A new turn on a paused thread returns 409 until those decisions are resolved. There is no auto-approval path.

Direct trigger creation: `{ "approved": true, "spec": { ... } }`. PATCH accepts `approved:true` plus a complete `spec` and/or `status:"paused"|"active"`. This field represents the authenticated user's approval action; the model does not get a tool that can set it.

CSV headers:

```text
asset_class,name,ticker,quantity,cost_basis,principal,apy,start_date,maturity_date
```

## Demo path

1. Seed the optional fixture and start both processes. Check `/api/portfolio`.
2. POST `/api/chat` with `{"message":"I see many Teslas on the road, why?"}`. Keep the returned thread and proposal IDs. Confirm `/api/triggers` is empty before approval.
3. Approve all three cards through `/api/chat/{thread_id}/resume`. Save the returned trigger IDs.
4. Ask for a report using the same thread. Poll the job or watch `/api/events`. Search `/api/reports?q=EV%20subsidies` and open a result.
5. Put one approved ID in `examples/normal-signal.json` and a **different** approved ID in `examples/critical-signal.json`. Using different triggers avoids the intentional cooldown. POST each to `/api/dev/inject-signal`. Repeat external IDs are deduped; change IDs for new events.
6. Check `/api/alerts?status=all` and evaluation history. The worker records demo text/call intents; live delivery needs the notifier setup below.

## What you need for live operation

Put secrets in the untracked `.env`, not in chat or source files. Use a separate live database; demo reports use a different embedding space and should not appear in the live index.

1. **Tiger Cloud:** create a Postgres service in the [Tiger console](https://console.cloud.timescale.com/), copy its TLS connection URL into `DATABASE_URL` (`postgresql://...?...sslmode=require`), and allow your app host to connect. The app creates base tables, pgvector and LangGraph checkpoint tables on startup; the DB user needs permission for those. Start the API once, then optionally apply `sql/001_timescale.sql` for hypertables, seven-day quote compression and a daily continuous aggregate. Base queries also work on ordinary Postgres tables. This initial schema uses JSON columns for holding fields and trigger specs; it preserves exact event dedupe in a regular signal table. It uses schema bootstrap, not an incremental production migration framework.
2. **NVIDIA:** create an account at [build.nvidia.com](https://build.nvidia.com/) and generate an API key with access to your selected [Super model](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-super-vl-120b-a12b), Nano and embedding endpoints. Set `NVIDIA_API_KEY`, or provide separate per-model keys. The default embedding model is the documented 2048-dimension `nvidia/llama-nemotron-embed-vl-1b-v2`; `EMBED_MODEL` and `EMBED_DIMENSIONS` are configurable for the spec's preferred Nemotron 3.5 Embed deployment. Confirm access/model IDs in your account. Hosted availability, limits and billing depend on that account. Only seeded holdings should go to hosted demo models; phone numbers are read solely by the notifier path.
3. **Finnhub:** create an account at [finnhub.io](https://finnhub.io/), generate a key, and set `FINNHUB_API_KEY`. Confirm the account permits [quotes and company news](https://finnhub.io/docs/api). Polling is limited to held/watched tickers; provider 429s are retried with bounded backoff.
4. **Alerts developer:** supply `NOTIFIER_URL` and a strong shared `NOTIFIER_TOKEN`, configure `ALERT_PHONE` in E.164 format, and set `DASHBOARD_URL`. That developer needs a Photon project/line and its credentials, LiveKit SIP (or Retell), and Riva TTS access. Those credentials stay in the notifier; the Python backend does not need them. A critical alert cannot ring a phone until that separate service works.
5. Set `DEMO_MODE=false`, use a strong random `API_TOKEN`, and normally disable `ENABLE_DEV_INJECTION`. Keep injection enabled only for your controlled live demo if you explicitly want it to contact the real notifier.

Brev is optional for starting live: all models can use hosted endpoints. To use your L40S, provision it in Brev and run Nano and Embed OpenAI-compatible servers. Set `NANO_BASE_URL`, `NANO_MODEL`, `EMBED_BASE_URL`, `EMBED_MODEL` and any per-server keys to their reachable endpoints. Keep Super hosted and cap Nano context to 32K. GPU provisioning/model serving is infrastructure setup, not an action this repository can perform without your Brev account. See [NVIDIA's model configuration guidance](https://docs.nvidia.com/rag/latest/change-model.html).

The backend validates every embedding's size and stores its model ID. If changing the embedding model/dimensions, re-embed existing reports into a fresh database or migrate them deliberately. `sql/002_vectors.sql` optionally builds StreamingDiskANN indexes for a **single-model, 2048-dimension** live database; otherwise exact pgvector distance search is sufficient at demo scale. The script deliberately pins column dimensions. See [pgvector Python](https://github.com/pgvector/pgvector-python) and [pgvectorscale](https://github.com/timescale/pgvectorscale).

No Alpaca, NYT, FRED, Congress.gov, Steel or FT account/key is required for this MVP because those adapters are cut in the spec.

## Notifier handoff

The worker POSTs `NOTIFIER_URL/notify` with `Authorization: Bearer NOTIFIER_TOKEN`, `Idempotency-Key: <alert_id>` and:

```json
{
  "alert_id": "uuid",
  "level": "Critical",
  "phone": "+15555550123",
  "title": "Tesla – leadership and legal",
  "summary": "A short evidence-grounded summary",
  "url": "https://dashboard.example/?alert=uuid",
  "channel": "call"
}
```

The notifier **must persist idempotency by alert ID**, return 2xx once it accepts responsibility, and honor `channel` (`text` or `call`). Critical alerts throttled by the backend still have `level=Critical` but `channel=text`; their text must say CRITICAL. Do not infer permission to call from level alone. The HTTP timeout is 15 seconds; network/5xx failures can be retried up to three times with the same idempotency key. A worker crash after acceptance can cause a retry, so notifier-side idempotency is essential.

Calls, rendering/playback, no-answer retry after two minutes, detail text and fallback are notifier responsibilities. The backend's delivery states are `pending → sending → accepted → sent/delivered/calling/missed/text_fallback/failed`; `retry` is transient, `demo_recorded` is simulation-only. Send provider updates to:

```text
PATCH /api/internal/alerts/{alert_id}/delivery
Authorization: Bearer NOTIFIER_TOKEN
{"status":"delivered"}
```

Allowed callback statuses: `sent`, `delivered`, `failed`, `calling`, `missed`, `acknowledged`, `text_fallback`. Acknowledgement and delivered/fallback receipts are terminal and late callbacks cannot undo them. Poll alert state before notifier-owned missed-call retries if implementing end-to-end acknowledgement cancellation. `/api/events` delivers `alert`, `trigger_status`, `delivery_status`, `portfolio_updated`, `alert_snoozed`, and `research_job` events.

## Validation

```sh
uv run pytest -q
uv run ruff check backend tests
python -m compileall -q backend tests
PYTHONPATH=backend python -m unittest discover -s tests -p test_policy.py -v
```

The integration suite checks portfolio/CSV behavior, persisted approvals across application restart, editing/rejection, no trade execution, injected severity/deduplication/cooldowns, acknowledgement callbacks, durable demo delivery/global call limits, background research and similar-report exclusions. Live service tests require real credentials and are intentionally separate from these deterministic tests.

The backend integration suite and frontend client/proxy contract tests cover the local demo path. Run the commands above plus `npm run test:api`, `npm run typecheck`, `npm run lint` and `npm run build` inside `finhub`. Browser verification covered portfolio rendering, persisted approval cards after reload, edited approvals, research completion/search, normal and critical injection, acknowledgement, pause/resume, holdings CRUD and multipart CSV import, with no console errors or warnings. The 390px layout had no horizontal page overflow. No real Tiger connection or phone call has been verified; those require live service credentials.
