Personal Finance Hub — Product Spec (Hackathon MVP)

Overview
Finance Hub is a single-user hackathon MVP with two parts. A dashboard shows net worth, allocation and live triggers. An advisor chat, built on Nemotron, turns everyday observations into research reports and watch triggers. Alerts go out by iMessage text when they are normal and by phone call when they are critical.

Decisions locked for the MVP

Scope: hackathon demo, one user, real prices, seeded holdings, about 2 hours of build time.
Holdings: manual entry or CSV upload. Live stock prices come from a market-data API.
Agent authority: advice, research and triggers only. The agent never places trades.
Trigger engine: change-point and anomaly detection. A severity score decides whether the response is nothing, a text or a call.
Goals

Show net worth and its split across cash, CDs and stocks, refreshed during market hours.
Turn a casual question ("Why do I see so many Teslas?") into context, related tickers and proposed triggers in one chat turn.
Produce sourced research reports on request and retrieve them by meaning, including similar reports.
Watch real-time signals and escalate by severity: OK, normal alert (text) or critical alert (call).
Non-goals

Trade execution or brokerage connections.
Account aggregation such as Plaid.
Multi-user accounts, tax planning and retirement modelling.
Claims of personalised investment advice. Every agent answer carries an "educational, not financial advice" note.
Demo success criteria

The Tesla question goes end to end (answer, then triggers accepted, then report requested) in under 3 minutes.
An injected critical event rings the user's phone within 60 seconds of detection.
User stories
Nine stories cover the MVP. US-1 to US-6 and US-8 are must-haves for the demo, and US-7 and US-9 are stretch goals.

ID As the user, I want to… Acceptance criteria
US-1 Enter holdings by form or CSV Cash, CD (principal, APY, maturity) and stock (ticker, qty, cost basis) rows saved. Dashboard totals update within 5 s.
US-2 See net worth over time Daily snapshot line chart with 1M, 3M, 1Y and All ranges.
US-3 Ask a casual market question The answer explains the trend, cites at least 1 source, lists related tickers, shows my exposure and proposes 2–5 triggers.
US-4 Approve, edit or reject proposed triggers Approved triggers appear on the dashboard and start polling within one interval. Nothing is created without approval.
US-5 Request a deep research report The job runs in the background. I'm told in chat (and by text, if I've left) when it's ready. The report has sections, citations and suggested triggers.
US-6 Search my reports by topic A query such as "EV subsidies" returns the best-matching reports plus 3 similar ones, even without exact keyword matches.
US-7 Reply to an alert text (stretch) "ack", "mute 24h" and "details" replies are handled.
US-8 Get a call for critical alerts The phone rings and a voice reads the summary. A text with details and a link follows. Missed calls retry once, then fall back to text.
US-9 Acknowledge and snooze alerts (stretch) Ack and snooze on the dashboard stop retries and suppress repeats for the cooldown.
System architecture
The system runs as four processes around one Tiger DB: the Next.js web app, the FastAPI backend (advisor graph, research graph, trigger worker), a TypeScript notifier for Photon, and model and browser services on Brev.

[embedded content: System architecture · 4 processes, 1 database]

The highlighted line is the only way an alert reaches the phone: trigger worker, then notifier, then Photon. Every agent reads and writes Tiger DB. Model, browser and data-API calls leave the backend through the bus on the right.

Dashboard
The dashboard is one read-only page with eight widgets. Holdings are the only thing the user edits there, and alerts arrive live over server-sent events (SSE).

Widget Shows Data Refresh
Net worth headline Total, day change in $ and % holdings × latest price 60 s in market hours, else on load
Allocation Donut of Cash / CDs / Stocks, drilling into stocks by ticker holdings, prices On change
Net worth history Line chart, 1M / 3M / 1Y / All net_worth_snapshots (daily continuous aggregate) Daily after close
Holdings Ticker, qty, cost basis, price, value, gain $ and % holdings, prices 60 s
CD ladder Principal, APY, maturity date, accrued value, days to maturity holdings (asset_class = cd) Daily
Active triggers Name, tickers, signals watched, last check, status (OK / Normal / Critical), 24 h severity sparkline triggers, trigger_evaluations 30 s
Alert feed Newest first: level, trigger, summary, evidence links, delivery status, Ack button alerts Live (SSE)
Recent reports Title, date, tickers. Clicking opens the report with "Similar reports" reports On change
CD accrued value uses daily compounding as an approximation:

V = P \left(1 + \frac{APY}{365}\right)^{d}
Here P is principal and d is days since purchase. Cash is entered as a balance. Stock value is quantity × the latest price.

The page also has a holdings editor (form plus CSV import with columns asset_class, name, ticker, quantity, cost_basis, principal, apy, start_date, maturity_date) and a chat panel docked on the right, so a trigger approved in chat appears in the triggers widget straight away.

Advisor chat agent
The advisor is a LangGraph StateGraph. A Nemotron 3 Nano router sends each turn to one of four intents, and a Nemotron 3 Super tool-calling agent writes the answer. Creating a trigger always pauses the graph with an interrupt until the user approves.

Intents

Market curiosity: "Why are there so many Teslas?" The agent explains, then proposes tickers and triggers.
Portfolio question: "How much am I in tech?" The agent answers from holdings.
Research request: "Write me a report on EV policy." This starts a research job.
Trigger management: "Pause the Tesla trigger." The agent lists, edits or pauses triggers.
Tools

Tool Does Side effects
get_portfolio() Holdings, totals, weight per ticker and asset class None
get_quote(ticker), get_history(ticker, range) Latest price, history and basic stats None
search_news(query, days) Fast headline lookup (NYT, market-data news) None
search_reports(query, k) Semantic search over past reports None
request_research(topic, questions[]) Queues a research job and returns its job_id Writes research_jobs
propose_triggers(entity, context) Returns 2–5 TriggerSpec drafts (see Trigger agents) None
create_trigger(spec) Saves an approved spec and schedules it Writes triggers, needs approval
update_trigger(id, patch) Pauses, resumes, edits thresholds Writes triggers, needs approval
Worked example: "I see a lot of Teslas on the road. Why?"

The router classifies the turn as market curiosity.
The agent calls get_quote("TSLA"), search_news("Tesla sales market share", 30), search_reports("Tesla") and get_portfolio() in parallel.
It answers with why Teslas are common (US EV share, price cuts, Supercharger network), each fact cited. Then comes a TSLA snapshot and the user's current exposure, such as "TSLA is 4.2% of your net worth."
It lists ways to follow the theme: TSLA itself, EV and autonomy ETFs, competitors and suppliers. These are framed as things to research, not recommendations.
It proposes triggers as approval cards:
Leadership and legal: investigations, lawsuits or SEC actions involving Tesla or Elon Musk.
Policy: federal or state EV incentive and tariff changes.
Fundamentals: quarterly delivery reports and earnings dates.
Safety: NHTSA recalls and investigations.
Price: TSLA daily return or volume beyond its normal range.
The user approves, edits or rejects each card. The graph resumes and create_trigger runs once per approval.
The agent offers a deep report ("Tesla's US position and the risks to it") and runs request_research if the user accepts.
Guardrails

Every price, percentage or holding figure comes from a tool result in the same turn, never from the model's memory. A post-check flags numbers with no tool source.
Factual claims carry a citation, or say plainly that they are unverified.
No trade actions exist in the toolset. Requests to buy or sell get an explanation, not an order.
Each answer ends with an "educational, not financial advice" note.
Conversation state persists through LangGraph's Postgres checkpointer in Tiger DB, so threads survive restarts.
Research agent and report index
The research agent is an asynchronous LangGraph subgraph that writes a cited report in about 2–5 minutes. It prefers official APIs and uses Steel Browser only for pages that have no API. Finished reports are chunked, embedded with a Nemotron embedding model and searched with vector + BM25 retrieval followed by a Nemotron reranker.

Pipeline

Plan (Nano): split the topic into 3–6 sub-questions and pick sources for each, e.g. "federal EV policy" maps to Federal Register and Congress.gov.
Gather: call the APIs first (NYT, FRED, SEC EDGAR, BLS, Federal Register, NHTSA). For other pages, Steel opens a session and returns readable markdown. Cap: 25 documents per report.
Extract (Nano): pull claims, figures and dates from each document, keeping the URL, publisher and date beside each.
Synthesise (Super): write the report in a fixed template: Summary, Key findings, Drivers and risks (bull / bear), Affected tickers and the user's exposure, Suggested triggers, Sources.
Critique (Super, second pass): check that every finding has a citation and every number matches its source. Remove or flag what fails. One revision loop at most.
Store and index: save the report, its sources and chunks, embed them, then notify the chat thread (and send a text if the user is away).
Indexing

Each report gets one summary embedding (for "similar reports") and roughly 800-token chunk embeddings (for passage search).
Vectors sit in pgvector columns with a pgvectorscale StreamingDiskANN index. A BM25 index (pg_textsearch) catches exact tickers and names that embeddings blur.
Embedding runs in app code against the embed NIM's OpenAI-compatible endpoint. pgai Vectorizer is an option if it accepts that endpoint, which is untested.
Retrieval for "find me the report on X"

Embed the query, take the top 20 chunks by vector and the top 20 by BM25, and merge them with reciprocal-rank fusion.
Rerank the merged set with the Nemotron reranker and group by report.
Return the top 3 reports with their best passage, plus up to 3 "similar reports" by summary-embedding nearest neighbour, excluding those already shown.
Content rules

Store short excerpts, links and the agent's own synthesis, never full copies of NYT or FT articles.
Do not bypass paywalls or log in to sources the project has no licence for. FT content needs a licence (see External data sources).
Respect each API's rate limits. SEC EDGAR needs a descriptive User-Agent that identifies the app's operator.
Trigger agents
Each trigger works in two stages. First, cheap statistical detectors run on every poll. Then, only when a detector fires, a Nemotron 3 Nano triage step runs. A 0–100 severity score maps each evaluation to OK (log only), Normal alert (text) or Critical alert (call). This is how "severity decides the response" works: the response follows the score, not a single threshold.

Trigger spec (what propose_triggers drafts and the user approves)

{
"name": "Tesla – leadership & legal",
"entity": "Tesla",
"tickers": ["TSLA"],
"hypothesis": "Investigations or legal action involving Tesla or Elon Musk move TSLA",
"signals": [
{"source": "news", "query": "Tesla OR Musk investigation OR lawsuit OR SEC", "detector": "text_event", "poll": "5m"},
{"source": "sec_edgar", "query": "TSLA 8-K", "detector": "text_event", "poll": "15m"},
{"source": "price", "query": "TSLA", "detector": "return_zscore", "params": {"window": 20, "z": 2.5}, "poll": "1m"}
],
"critical_capable": true,
"cooldown": {"normal": "6h", "critical": "1h"}
}
Stage 1: detectors

Signal kind Detector Fires when Magnitude (0–1)
Price return Rolling z-score of returns, 20-period window |z| ≥ 2.5 min(|z| / 5, 1)
Price level / trend CUSUM, or Bayesian online change-point detection (BOCPD) Change-point probability ≥ 0.8 That probability
Volume Ratio to 20-day median Ratio ≥ 3 min(ratio / 6, 1)
News volume Hourly article count vs. a 7-day baseline (Poisson) p < 0.01 1 − p, scaled
Text event (news, filings, regulations, recalls) Relevance (embedding similarity to the hypothesis) × novelty (distance from the last 50 events) Relevance ≥ 0.6 and novelty ≥ 0.3 relevance × novelty, scaled
Stage 2: severity score and triage

S = 100\,(0.35\,M + 0.25\,E + 0.20\,C + 0.20\,U)
Each input runs from 0 to 1:

M (magnitude) comes from the detector.
E (exposure) is the affected tickers' share of net worth, where 10% or more counts as 1.
C (credibility) depends on the source: 1.0 for government data and filings, 0.8 for major outlets, 0.5 for other sites.
U (urgency) is set by the triage model: 1.0 means price impact is likely within a day.
The triage model (Nano) gets the detector output, the evidence text, the portfolio exposure and the trigger hypothesis. It returns JSON: {urgency, adjustment (−15 to +15), level, summary (≤ 280 chars), rationale, evidence_urls}.

Final score Level Response
Below 40 OK (normal signal) Log the evaluation, update the sparkline, keep polling
40–74 Normal alert iMessage text. Dashboard alert. Normal alerts during quiet hours are batched into one morning text.
75 and above Critical alert Phone call, then a detail text. This overrides quiet hours.
Hard rules the model cannot override

Critical requires all three: M ≥ 0.6, critical_capable = true, and E ≥ 0.05 or a user-pinned trigger. Otherwise the level is capped at Normal.
The model's adjustment is clamped to ±15 points and cannot invent evidence. Each alert needs at least one stored signal event.
Dedupe: an alert for the same trigger and event cluster (embedding similarity ≥ 0.85) within its cooldown is suppressed. It re-alerts only if the score rises by 20 or more.
At most 3 calls per day across all triggers. Further critical alerts send a text marked CRITICAL.
Runtime

A worker process runs an asyncio scheduler. Each due signal runs a small LangGraph graph: fetch, detect, then (if fired) triage, score, decide and dispatch.
Default polls: prices every 1 minute in market hours, news every 5 minutes, filings, regulations and recalls every 15–60 minutes.
Every evaluation is written to the trigger_evaluations hypertable, so the dashboard sparkline and post-mortems come free.
Replay mode (for the demo): POST /api/dev/inject-signal pushes a synthetic event through the same path, so a critical call can be shown on cue.
Alert delivery via Photon
A small TypeScript notifier service sends every alert, because Photon's Spectrum SDK (spectrum-ts) is TypeScript-only. Texting works out of the box. Calls need extra work: Photon handles only the SIP signalling, so the voice and text-to-speech (TTS) have to come from our own SIP app (Photon docs).

Level Channel Content Fallback
Normal iMessage text from the project's Photon line [NORMAL] Tesla – leadership & legal (58), a 1-sentence summary, a dashboard link Batched into a morning digest during quiet hours
Critical Outbound call, then an iMessage text About 20 s of TTS: trigger, what happened, "details sent by text". Press 1 to acknowledge (stretch). No answer: retry after 2 min, then send "Missed critical call" with details
Notifier service

POST /notify {alert_id, level, phone, title, summary, url}, called by the trigger worker. Delivery status is written back to alerts.
Texting: spectrum-ts with the iMessage provider and project credentials.
Calling: a LiveKit SIP trunk (or Retell) pointed at sip.spectrum.photon.codes:5061 over TLS, using the project ID and secret as credentials. The caller ID must be the project's iMessage line. Before dialling, NVIDIA Riva TTS renders the script to a WAV file, and LiveKit plays it into the call. Rendering first keeps streaming audio out of the critical path. Use NVIDIA's hosted Riva endpoint if your API key has access. Otherwise run Riva on the L40S, after checking it fits in the roughly 14 GB left beside Nano.
Inbound replies (US-7, stretch): Photon webhook, HMAC-verified, deduped on message.id. It parses ack, mute 24h and details.
Confirmed with Photon (Nov 7): the plan includes outbound voice, and the agent can text the user's number before the user has messaged the line. SMS fallback for non-iPhones isn't in the SDK docs, so the demo uses an iPhone.

Data model (Tiger DB)
One Tiger Cloud Postgres service holds everything: relational tables, TimescaleDB hypertables for time series, and pgvector columns for embeddings. LangGraph's checkpoint tables live in the same database.

Table Kind Key columns Notes
user_profile Table (1 row) phone, timezone, quiet_hours, max_calls_per_day Phone stored encrypted
holdings Table id, asset_class (cash, cd, stock), name, ticker, quantity, cost_basis, principal, apy, start_date, maturity_date Manual and CSV source
prices Hypertable ticker, ts, price, volume Compress after 7 days
net_worth_snapshots Hypertable ts, total, cash, cd, stocks Daily continuous aggregate feeds the history chart
research_jobs Table id, topic, questions[], status, thread_id, report_id, error Polled by the chat UI
reports Table id, title, topic, summary, body_md, tickers[], created_at, summary_embedding vector(N) N set by the chosen embed model
report_chunks Table report_id, idx, text, embedding vector(N) StreamingDiskANN index plus BM25 index on text
report_sources Table report_id, url, publisher, published_at, excerpt Excerpts only
triggers Table id, name, entity, tickers[], hypothesis, signals jsonb, critical_capable, pinned, cooldown jsonb, status, thread_id From approved TriggerSpecs
signal_events Hypertable trigger_id, ts, source, external_id, title, url, raw jsonb, embedding vector(N) external_id is unique, for dedupe
trigger_evaluations Hypertable trigger_id, ts, magnitude, exposure, credibility, urgency, adjustment, severity, level, triage jsonb Feeds the sparkline and audit trail
alerts Table id, trigger_id, evaluation_ts, level, severity, summary, evidence jsonb, channel, delivery_status, attempts, acked_at, snoozed_until Feeds the alert feed
checkpoints and related LangGraph-managed thread_id, checkpoint Created by langgraph-checkpoint-postgres
Tech stack and model selection
Only Nemotron 3 Nano is self-hosted. At FP8 it fits on one 48 GB GPU, with the 1B embedding model beside it. Nemotron 3 Super is too big for limited hardware, so it runs on NVIDIA's free hosted endpoint and uses no Brev GPU at all.

Model sizes

Active parameters set speed, not memory. In a mixture-of-experts model every expert must sit in GPU memory, so Nano needs memory for about 30B parameters, not 3B (Thunder Compute).

Model Total / active params Memory, BF16 Memory, FP8 Memory, 4-bit Verdict
Nemotron 3 Nano 30B-A3B 31.6B / about 3.6B ~60 GB ~32 GB ~17 GB Self-host. One L40S 48 GB at FP8, or one 24 GB card at 4-bit
Nemotron 3 Super 120B-A12B 120.6B / 12.7B ~240 GB ~128 GB ~64–72 GB Don't self-host. Use the free hosted endpoint
Nemotron 3 Nano 4B 4B, dense Small Small Runs on an 8 GB Jetson Fallback for routing and triage if no 24 GB GPU is available
Nemotron 3.5 Embed 1B 1B Small Small Small Self-host beside Nano
Memory figures are approximate and leave out the KV cache, which grows with context length. Cap context at 32K tokens on the Nano server so the cache stays small.

Layer Technology Role in Finance Hub Notes
Fast LLM Nemotron 3 Nano 30B-A3B (FP8), self-hosted NIM or vLLM Router, trigger triage, research plan and extract. Fallback for the advisor. 1M-token context available, capped at 32K here
Reasoning LLM Nemotron 3 Super, NVIDIA hosted API (integrate.api.nvidia.com) Advisor answers, report synthesis and critique No GPU needed. Rate-limited free tier.
Embed and rerank Nemotron 3.5 Embed 1B self-hosted. Rerank through the hosted API. Report chunks, summaries, signal novelty, retrieval reranking Embed 1B returns 2048-dim vectors that can be truncated (OpenRouter)
GPU platform NVIDIA Brev One GPU instance for Nano and embed Brev suggests an L40S 48GB or A100 80GB for NIMs
Database Tiger Cloud (TimescaleDB, pgvector, pgvectorscale, pgai, pg_textsearch) All app data, time series, vectors, BM25, LangGraph checkpoints One service, so no separate vector DB
Orchestration LangGraph (Python) Advisor graph, research subgraph, per-evaluation trigger graph, human-in-the-loop interrupts Postgres checkpointer
Browser Steel Browser, self-hosted in Docker Fetch and render non-API pages as markdown, screenshots or PDF Open source (Apache 2.0). Steel Cloud is the fallback.
Messaging and calls Photon Spectrum (spectrum-ts) plus a LiveKit SIP trunk and NVIDIA Riva TTS Alert texts and critical calls TypeScript notifier service
Backend FastAPI (Python) REST and SSE API, LangGraph host, trigger worker Same codebase, two processes
Frontend Next.js, Tailwind, Recharts Dashboard and chat SSE for chat streaming and live alerts
GPU plan, by budget

Chosen (one 48 GB GPU, e.g. L40S): Nano at FP8 (about 32 GB) plus Embed 1B (about 2 GB at BF16). That leaves roughly 14 GB for the KV cache and runtime overhead, which is why the Nano server's context is capped at 32K. App containers, Steel and the notifier run on a small CPU instance, or on the same box if credits are tight.
Fallback if the 48 GB GPU is unavailable (one 24 GB GPU): Nano at 4-bit (about 17 GB). Embeddings go to the hosted API.
No GPU: every model goes through hosted endpoints, and Brev runs only the app containers.
In every tier, Super stays on the hosted endpoint. NVIDIA logs free-endpoint traffic and asks users not to send confidential or personal data. So the demo uses seeded holdings, and the phone number never goes into a prompt.
All model calls go through one OpenAI-compatible client with a base_url per model. Moving the advisor from Super to Nano, or from hosted to self-hosted, is then a config change.
External data sources
The MVP uses free official APIs for government data and filings, NYT's developer APIs for headlines and abstracts, and one market-data API for prices. FT is optional because it needs a licence. Check rate limits and terms for each source in the first hour of the build. The access notes below come from general knowledge and were not re-checked for this spec.

Source Data Used by Access note
Finnhub (quotes, news), Alpaca (historical bars) Quotes, history, volume, company news Dashboard, price and volume detectors, advisor Free tiers are rate-limited, so poll only tickers that are held or watched
NYT Developer APIs (Article Search, Top Stories) Headlines, abstracts, URLs, dates News detector, research, advisor Free key. Metadata and abstracts, not full text.
Financial Times Articles and analysis Research (optional) Needs licensed access. Without it, store links only.
SEC EDGAR 8-K, 10-Q, 10-K filings, full-text search Filings detector, research Free. Needs a User-Agent with the operator's contact.
FRED (St. Louis Fed) Rates, CPI, macro series Research, macro triggers Free key
BLS / BEA / Treasury Fiscal Data Jobs, inflation, GDP, Treasury yields Research Free
Federal Register and Congress.gov Rules, proposed rules, bills (e.g. EV incentives, tariffs) Policy detector, research Free (Congress.gov needs a key)
NHTSA Recalls and defect investigations Safety detector (Tesla example) Free
Other sites via Steel Agency press releases, company IR pages Research Only public pages. No paywall bypass.
API surface
FastAPI serves the app API, and the TypeScript notifier exposes two internal routes. With one user, auth is a single bearer token in an environment variable.

Method Path Purpose
GET /api/portfolio Totals, allocation, holdings with live values
POST / PATCH / DELETE /api/holdings[/{id}] Manual holdings CRUD
POST /api/holdings/import CSV upload, validated row by row
GET /api/networth/history?range=1M Snapshot series
POST /api/chat Send a message. SSE stream of tokens, tool events and trigger-approval cards.
POST /api/chat/{thread_id}/resume Approve, edit or reject proposed triggers (resumes the LangGraph interrupt)
GET / POST / PATCH / DELETE /api/triggers[/{id}] List, create, pause or edit triggers
GET /api/triggers/{id}/evaluations?since= Severity history for the sparkline
GET /api/alerts?status=open Alert feed
POST /api/alerts/{id}/ack, /api/alerts/{id}/snooze Stop retries, suppress repeats
GET /api/events SSE stream: new alerts, trigger status, research job updates
POST /api/research Start a research job (also reachable through chat)
GET /api/research/{job_id} Job status
GET /api/reports?q= Semantic search (best matches and similar reports)
GET /api/reports/{id} Report with sources and similar reports
POST /api/dev/inject-signal Demo replay: push a synthetic event through a trigger
POST notifier:/notify (internal) Send a text or place a call for an alert
POST notifier:/photon/webhook Inbound alert replies (stretch)
Build plan and demo script
Two developers have about 2 hours, so the MVP shrinks to one end-to-end demo path. That path runs: seeded portfolio, the Tesla question, approved triggers, an injected event, then a text and a phone call. Research is a single Super call with vector search. Dev A owns the backend and agents, and Dev B owns the frontend and alerts. The two teammates on the presentation prepare the seed content, so neither developer writes demo data. If you get more time, add cut items back in the order listed.

Build schedule (2 hours, 2 developers)

Time Dev A: backend and agents Dev B: frontend and alerts
0:00–0:30 Tiger schema, load the seed file. Model client (hosted Super and hosted Nano). Start the Nano and Embed NIMs on the Brev L40S, then leave them running. Photon text from spectrum-ts reaches the demo iPhone. Riva renders the call WAV. Next.js page showing net worth, allocation donut and holdings from the API.
0:30–1:00 Advisor graph: get_portfolio, get_quote and search_news (Finnhub), propose_triggers, approval interrupt and resume LiveKit SIP to Photon, outbound call that plays the WAV. /notify route: Normal sends a text, Critical places a call then sends a text. Gate 1:00: the phone rings.
1:00–1:30 Trigger worker: Finnhub daily % change and news keyword match, 1-minute loop. /api/dev/inject-signal. Nano triage, severity score, bands, call /notify. Chat panel with streaming and approval cards. Triggers widget and alert feed (polls every 5 s).
1:30–1:50 request_research: one Super call over Finnhub news, embed, store. search_reports with pgvector. Report view and search box. Style pass.
1:50–2:00 Both: run the demo path end to end, fix only blockers. Switch Nano to the Brev NIM if it's serving.
Prep by the presentation pair (in parallel, no code)

Seed file: holdings (cash, 2 CDs, 6 stocks including TSLA at about 4% of net worth) and 30 days of net-worth snapshots.
2 example reports (EV policy, US auto market), written with any assistant, for the similar-reports search.
The two injected events (normal: minor recall; critical: SEC action plus a −8% move) as ready-to-paste JSON.
Demo script, slides and recording setup, including phone screen recording.
Fallbacks

Brev NIM not serving by 0:45: keep using the hosted Nano endpoint, and show the Brev instance in the presentation.
Phone not ringing by 1:00: critical alerts go out as a text marked CRITICAL. If the call gets fixed later, record it as a separate clip.
Research agent too slow on camera: show a seeded report, and run the agent off-camera.
Cut, in order to add back

Steel Browser pages and NYT in research. Research uses Finnhub news only.
Alpaca historical bars and the price z-score. Until then, the price detector fires when Finnhub's daily % change is 3% or more.
Net worth history chart and CD ladder widget (seed data already supports both).
Research critique pass and BM25. Search is vector-only.
Quiet hours and the 3-calls-per-day cap. Instead, a simple guard allows at most 1 call per 5 minutes.
Dedupe by embedding similarity. Instead, each trigger has a flat 30-minute cooldown.
Holdings editor and CSV import. Holdings come from the seed file.
SEC, FRED, Federal Register and NHTSA detectors, change-point detectors, the reranker, text replies and snooze.
Demo script for the recording (about 4 minutes)

Dashboard: net worth, allocation and holdings with live prices.
In chat, ask "I see a lot of Teslas on the road, why?" Show the cited answer, TSLA exposure and 3–4 trigger cards. Approve 3, and the triggers widget picks them up.
Ask for a deep report. Cut while it runs, then show the finished report. Search "EV subsidies" and show it returned with a seeded similar report.
Inject a normal event (a minor recall) and show the iMessage text on the phone.
Inject a critical event (an SEC action against the CEO plus a −8% move). The phone rings, Riva reads the summary, and the detail text follows.
End on the alert feed: severity breakdown, triage rationale, evidence links.
Record each step as its own clip so a failed step can be retaken alone. Screen-record the phone for steps 4 and 5.

Risks and open questions
The two biggest risks are Photon voice setup and false-positive critical calls. Both are handled by building the alert path first and capping what the model can escalate.

Risk Impact Mitigation
Photon voice still needs the SIP app and Riva TTS wired up (plan confirmed) No live call in the demo Gate at H4. Fallback: send the critical alert as a text marked CRITICAL and show the call flow from logs.
Model invents numbers or facts Wrong advice, lost trust Numbers only from tools in the same turn, a post-check on numbers, citations required, a critique pass on reports
Noisy detectors cause alert fatigue or 3 a.m. calls User ignores alerts Two-stage scoring, hard critical rules, cooldowns, a 3-calls-per-day cap, quiet-hours batching
NYT / FT licensing Takedown or ToS breach Metadata, short excerpts and links only. FT only with a licence.
GPU cost or availability on Brev Slow or blocked inference Super on the hosted endpoint, Nano and embed on one GPU, one OpenAI-compatible client so hosts can be swapped
Seen as unlicensed investment advice Legal exposure if it goes beyond the demo Advice-only toolset, disclaimers, no trade actions
Market-data rate limits Stale prices Poll only held and watched tickers, cache in the prices hypertable
Decided (Nov 7)

Team of 4: 2 developers build for about 2 hours. The other 2 handle seed content, the presentation and the recording.
GPU: one 48 GB L40S on Brev.
Photon plan includes outbound voice, and the agent can text the user's number first, so no opt-in step is needed.
Call audio uses NVIDIA Riva TTS.
Market data: Finnhub for quotes and company news, Alpaca for historical bars.
Severity: the default weights and the 40 / 75 cut-offs in Trigger agents.
No auto-created triggers. Every trigger needs the user's approval.
Sources
Photon docs (Spectrum SDK, voice, webhooks)
Photon iMessage platform page
Tiger Data overview (Tiger Cloud, pgvectorscale, pgai, pg_textsearch)
Steel Browser on GitHub
NVIDIA: Nemotron 3 family announcement
NVIDIA Developer blog: Nemotron 3 Super and the GTC 2026 models
Unite.AI: Nemotron 3.5 Embed and Rerank
NVIDIA Brev console reference
Deploying a NIM on Brev
