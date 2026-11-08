# Frontend/backend contract

FastAPI's `/docs` and the root [README](../README.md) define the HTTP wire contract. The frontend's
[`backend.ts`](lib/api/backend.ts) types describe those responses, and [`http.ts`](lib/api/http.ts)
normalizes them into the component view models in [`types.ts`](lib/api/types.ts). Browser mocks
implement the view models; they are an optional UI preview, not the backend integration test.

## Transport and authentication

The browser calls `/api/*` on its own origin. The Next.js catch-all route streams requests/responses
to `BACKEND_URL`, attaches the **server-only** `BACKEND_API_TOKEN` (or `API_TOKEN`), and forwards
multipart uploads, abort signals and SSE without buffering the response. `NEXT_PUBLIC_API_TOKEN`
and direct browser-to-FastAPI URLs are no longer used. Internal notifier callbacks are not proxied.
Mutations carrying another site's Origin are rejected.

The root launcher supplies backend settings to the frontend automatically. For manual startup,
set `BACKEND_API_TOKEN` in the ignored `finhub/.env.local` to match the root `.env`'s `API_TOKEN`.
This is a local single-user app: bind it to loopback, as the launcher does. Protect access to the
Next.js app with deployment authentication before exposing it publicly; the backend shared token
is service authentication, not a frontend user session.

## Shared financial meanings

- Money is USD, represented as a number. **`cost_basis` is the total stock position cost**, in forms,
  CSV, mocks, database and HTTP. For 40 shares bought at $205, enter `8200`, not `205`.
- APY and portfolio weights are fractions. The backend's `day_change_percent`/`gain_percent` fields
  are percentage points; the HTTP adapter divides them by 100 for the UI's `_pct` fields.
- Unpriced values, incomplete total net worth, gains and weights remain `null`; the UI displays
  missing pricing instead of silently showing zero. `warnings` and `complete` describe pricing gaps.
- Backend evaluation `exposure` is raw portfolio share. The adapter normalizes it as
  `min(exposure / .10, 1)` for the severity graph. Alert `breakdown.exposure` is already normalized.
- Times are UTC ISO strings with timezone. The backend supplies `market_open` using its XNYS
  calendar. `demo` identifies synthetic data independently of browser mock mode.

## Deliberate view-model adaptations

| FastAPI wire | Component view model |
| --- | --- |
| History `range=All`, response `{series}` | UI `ALL`, `{range,points}` |
| Trigger `{id,spec,status,level,...}` | Flat `Trigger`, lowercase `last_level` |
| Trigger `last_severity` | Last persisted evaluation's severity |
| Alert `created_at`, `Normal`/`Critical` | `ts`, `normal`/`critical` |
| Alert `trigger_name`, `rationale`, normalized `breakdown` | Shown directly in the feed's Why panel |
| Recent reports `{reports}` | `{results:[{report,passage:null,score:null}],similar:[]}` |
| Search `{matches:[{...report,passage,score}],similar}` | `{results:[{report,passage,score}],similar}` |
| Research `{id,status:"completed",...}` | `{job_id,status:"done",...}` |
| Trigger PATCH `{approved:true,status?,spec?}` | Pause/resume action; complete spec merged for spec edits |
| CSV invalid rows: HTTP 422 `{detail:{imported:0,rows:[...]}}` | Error with row numbers; no partial imports |

## Chat

The backend emits `thread`, `intent`, `tool`, `token`, `answer`, `trigger_approval`, `triggers_updated`,
`done`, and `error`. The adapter:

- Maps `trigger_approval` to approval cards and `triggers_updated.trigger_ids` to refreshed watches.
- Extracts source links and a research job card from the `tool` event's turn context.
- Displays token chunks and ignores the duplicate full `answer` text.
- Sends edited cards as `action:"edit"` with the complete spec, unedited cards as `approve`, and
  unchecked cards as `reject`. A resume always decides every pending card together.

`GET /api/chat/{thread_id}` restores durable history and pending approvals after reload. Failed or
stopped streams reconcile with that state. A retryable graph run uses `POST /api/chat/{id}/retry`;
409 errors are not interpreted as approval success. SSE framing supports fragmented UTF-8 and
CRLF boundaries. The model answer is grounded before its buffered text chunks are streamed.

## Demo injection and delivery

`POST /api/dev/inject-signal` requires the backend's explicit dev flag. The payload has
`trigger_id`, a supported source (`news`, `price`, `sec_edgar`, `nhtsa`), unique `external_id`,
`title`, absolute evidence `url`, `magnitude`, and `urgency`. Price-move input is folded into the
synthetic evidence title; it does not add an unsupported API field.

The drawer supplies labelled synthetic presets, source URLs and new event IDs. It prefers another
active watch after a successful event because cooldowns intentionally suppress repeats. A
suppressed evaluation explains the cooldown. Demo alerts never claim that a phone message was sent.
Delivery states include `pending`, `sending`, `accepted`, `calling`, `sent`, `delivered`, `retry`,
`missed`, `failed`, `text_fallback`, `acknowledged`, `cancelled`, and `demo_recorded`. A critical alert
can use `channel=text` when the call guard applies; the UI preserves its critical severity.

The dashboard polls alerts every five seconds and triggers/evaluations every 30 seconds. Research
cards poll their job until completion. FastAPI's reconnectable `/api/events` remains available for
clients that prefer it; polling and chat mutations already refresh this frontend.

Run `npm run test:api` for the client/proxy contract tests, and the root Python test suite for the
actual FastAPI behavior. `scripts/contract-stub.mjs` is the original standalone UI reference and
is not the integrated API contract; use the real backend for integration work.
