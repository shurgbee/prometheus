"""Import presentation-team content explicitly; never seed at application startup."""
import argparse
import asyncio
import json
from datetime import datetime

from sqlalchemy import func, select

from .config import Settings
from .db import Database, Holding, Snapshot
from .providers import Providers
from .research import ResearchService
from .schemas import HoldingInput, ResearchInput


async def load(path):
    data = json.loads(path.read_text())
    holdings = [HoldingInput.model_validate(row) for row in data["holdings"]]
    settings = Settings()
    db = Database(settings)
    providers = Providers(settings, db)
    try:
        await db.initialize()
        async with db.sessions() as session:
            if await session.scalar(select(func.count()).select_from(Holding)):
                raise ValueError("Holdings already exist; seed refused to avoid duplicate positions")
            session.add_all(Holding(data=row.model_dump(mode="json")) for row in holdings)
            for row in data.get("snapshots", []):
                session.add(Snapshot(ts=datetime.fromisoformat(row["ts"]),
                                     **{key: row[key] for key in ("total", "cash", "cd", "stocks")}))
            await session.commit()
        if settings.demo_mode:
            service = ResearchService(db, providers)
            for topic in data.get("demo_report_topics", []):
                job = await service.enqueue(ResearchInput(topic=topic, tickers=["TSLA"]))
                # The normal worker path performs indexing and publishes completion events.
                await service.run_next()
                print("Demo report queued/indexed:", job["id"])
        print(f"Imported {len(holdings)} holdings. Demo quotes are synthetic; use live credentials for real prices.")
    finally:
        await providers.close()
        await db.close()


def main():
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    args = parser.parse_args()
    asyncio.run(load(args.file))


if __name__ == "__main__":
    main()
