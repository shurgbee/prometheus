# Prometheus frontend

Next.js dashboard, advisor chat, reports and holdings editor, integrated with the FastAPI backend
in `../backend`. The default uses that backend. Synthetic data and phone delivery are clearly
labelled when the **backend** runs in demo mode.

## Run the complete app

From the project root:

```sh
cp .env.example .env  # only if you haven't already configured .env
uv sync --python 3.13 --extra dev
cd finhub
npm ci
cd ..
uv run python scripts/dev.py --seed
```

Open **http://127.0.0.1:3000**. The launcher runs FastAPI, the worker and Next.js, shares the root
`.env` API token with the server proxy, and stops all three on Ctrl-C. `--seed` imports the optional
smoke-test fixtures only when holdings are empty and requires backend demo mode. Omit it to keep
your existing holdings. Use `--api-port`/`--web-port` if those defaults are occupied.

For independent startup, run FastAPI and the worker from the root (see the root README), then:

```sh
cd finhub
cp .env.example .env.local
# Set BACKEND_API_TOKEN in .env.local to the root .env's API_TOKEN.
npm run dev
```

`BACKEND_URL` defaults to `http://127.0.0.1:8000`. The browser calls its own `/api/*`; the Next.js
server attaches the private bearer token and streams the backend response. Restart Next after
changing server settings. Do not put the token in a `NEXT_PUBLIC_*` variable. This local single-user
setup needs access protection before public deployment.

Set `NEXT_PUBLIC_USE_MOCKS=true` only for the independent in-browser UI preview. Browser mocks
reset on reload and do not test the Python backend. The root launcher always selects the backend.

## Integrated demo

1. Confirm **Demo data** is visible and the seeded portfolio loads.
2. Ask “I see a lot of Teslas on the road, why?” Rename a trigger or change its call permission,
   then approve. Watches appear immediately. Unapproved cards never create watches.
3. Reload while cards are pending to verify checkpoint recovery.
4. Ask for an EV report. Open its completion card, then search “EV subsidies” in Reports.
5. Open **Demo events**, send the minor recall preset, then switch to the critical SEC preset.
   The drawer prefers different active watches so the flat cooldown does not hide the second event.
   Open **Why** in Alerts to inspect the actual score and rationale. Demo mode sends no texts/calls.
6. Acknowledge an alert, pause/resume a watch, and add/edit/import a holding. Changes persist in
   the shared database. Cost basis in the form and CSV is **total position cost**, not per share.

Real delivery requires the separate notifier and live credentials described in the root README.

## Checks

```sh
npm run typecheck
npm run lint
npm run test:api
npm run build
```

See [API_CONTRACT.md](API_CONTRACT.md) for transport shapes, units, approvals and delivery semantics.
