"""Start the API, worker, finhub and (in live mode) the Photon notifier against the same root .env.

API_TOKEN is never exposed to JS.
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", action="store_true", help="Load smoke-test fixtures if holdings are empty")
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--web-port", type=int, default=3000)
    parser.add_argument("--no-notifier", action="store_true", help="Don't start the local Photon notifier")
    args = parser.parse_args()
    os.chdir(ROOT)
    from finance_hub.config import Settings
    settings = Settings()
    next_cli = ROOT / "finhub/node_modules/next/dist/bin/next"
    if not next_cli.exists():
        raise SystemExit("Install frontend dependencies first: cd finhub && npm ci")
    if args.seed:
        import asyncio
        from sqlalchemy import func, select
        from finance_hub.db import Database, Holding
        from finance_hub.seed import load

        async def seed_if_empty():
            db = Database(settings)
            try:
                await db.initialize()
                async with db.sessions() as session:
                    empty = not await session.scalar(select(func.count()).select_from(Holding))
            finally:
                await db.close()
            if empty:
                await load(ROOT / "examples/demo-seed.json")
            else:
                print("Existing holdings found; seed skipped.", flush=True)
        if not settings.demo_mode:
            raise SystemExit("--seed is for DEMO_MODE=true. Import your intended seed explicitly for live use.")
        asyncio.run(seed_if_empty())
    env = {**os.environ, "BACKEND_URL": f"http://127.0.0.1:{args.api_port}",
           "BACKEND_API_TOKEN": settings.api_token, "NEXT_PUBLIC_USE_MOCKS": "false"}
    commands = [
        ([sys.executable, "-m", "uvicorn", "finance_hub.api:create_app", "--factory",
          "--host", "127.0.0.1", "--port", str(args.api_port)], ROOT),
        ([sys.executable, "-m", "finance_hub.worker"], ROOT),
        (["node", str(next_cli), "dev", "--hostname", "127.0.0.1", "--port", str(args.web_port)], ROOT / "finhub"),
    ]
    # Live alerts go worker -> notifier -> Photon. Run the notifier here when NOTIFIER_URL is local.
    notifier_url = urlparse(settings.notifier_url)
    if not settings.demo_mode and not args.no_notifier and notifier_url.hostname in ("127.0.0.1", "localhost"):
        tsx_cli = ROOT / "notifier/node_modules/tsx/dist/cli.mjs"
        if not tsx_cli.exists():
            raise SystemExit("Install notifier dependencies first: cd notifier && npm install")
        env["NOTIFIER_BACKEND_URL"] = f"http://127.0.0.1:{args.api_port}"
        commands.append((["node", str(tsx_cli), "src/server.ts"], ROOT / "notifier"))
    children = []
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        for command, cwd in commands:
            children.append(subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True))
        print(f"Finance Hub: http://127.0.0.1:{args.web_port} ({'demo' if settings.demo_mode else 'live'})", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(.5)
        failed = next(child for child in children if child.poll() is not None)
        raise SystemExit(failed.returncode or 1)
    except KeyboardInterrupt:
        pass
    finally:
        for child in children:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    main()
