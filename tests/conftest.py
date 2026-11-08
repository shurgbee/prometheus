import pytest
from fastapi.testclient import TestClient

from finance_hub.api import create_app
from finance_hub.config import Settings

TOKEN = "a-long-test-token-for-backend"


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(_env_file=None, demo_mode=True, enable_dev_injection=True,
        api_token=TOKEN, notifier_token="notifier-test-token",
        database_url=f"sqlite+aiosqlite:///{tmp_path}/finance.db",
        checkpoint_sqlite_path=str(tmp_path / "checkpoints.db"), embed_dimensions=32))


@pytest.fixture
def client(app):
    with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as client:
        yield client


