import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import DBAPIError


async def test_dev_preflight_reports_missing_password_without_exposing_connection(monkeypatch):
    spec = importlib.util.spec_from_file_location("dev", Path(__file__).parents[1] / "scripts/dev.py")
    dev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dev)
    error = DBAPIError(None, None, Exception('password authentication failed for user "tsdbadmin"'))
    engine = SimpleNamespace(connect=lambda: (_ for _ in ()).throw(error))
    db = SimpleNamespace(engine=engine, close=AsyncMock())
    monkeypatch.setattr("finance_hub.db.Database", lambda _: db)
    with pytest.raises(SystemExit, match="DATABASE_URL contains no password") as failure:
        await dev.preflight_database(SimpleNamespace(database_url="postgres://tsdbadmin@private-host/db"))
    assert "private-host" not in str(failure.value)
    db.close.assert_awaited_once()
