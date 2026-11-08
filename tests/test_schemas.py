import math
import unittest

from pydantic import ValidationError

from finance_hub.config import Settings
from finance_hub.schemas import HoldingInput, SignalSpec, TriggerCreate


class SchemaTests(unittest.TestCase):
    def test_live_mode_requires_credentials_and_postgres(self):
        with self.assertRaises(ValidationError):
            Settings(_env_file=None, api_token="long-development-token", demo_mode=False,
                     database_url="sqlite+aiosqlite:///./invalid-live.db")
        self.assertTrue(Settings(_env_file=None, api_token="long-development-token", demo_mode=True).demo_mode)

    def test_holding_validation_matches_asset_requirements(self):
        valid = HoldingInput(asset_class="stock", name="Tesla", ticker="tsla", quantity=2, cost_basis=100)
        self.assertEqual(valid.ticker, "TSLA")
        for data in (
            dict(asset_class="cash", name="Cash", principal=-10),
            dict(asset_class="cash", name="Cash", principal=math.nan),
            dict(asset_class="stock", name="Stock", ticker="TSLA", quantity=1),
            dict(asset_class="cd", name="CD", principal=100, apy=.04,
                 start_date="2026-11-01", maturity_date="2026-10-01"),
        ):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                HoldingInput(**data)

    def test_signals_reject_unsupported_detectors_and_fast_polls(self):
        for data in (
            dict(source="sec_edgar", query="Tesla", detector="text_event"),
            dict(source="price", query="TSLA", detector="return_zscore"),
            dict(source="news", query="Tesla", detector="text_event", poll="1m"),
            dict(source="price", query="TSLA", detector="daily_change", params={"threshold_percent": math.nan}),
        ):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                SignalSpec(**data)

    def test_direct_trigger_creation_requires_explicit_approval(self):
        spec = dict(name="Watch", entity="Tesla", tickers=["TSLA"], hypothesis="test",
                    signals=[dict(source="news", query="Tesla", detector="text_event")])
        for approved in (None, False):
            with self.assertRaises(ValidationError):
                TriggerCreate(spec=spec, **({"approved": approved} if approved is not None else {}))
        self.assertTrue(TriggerCreate(spec=spec, approved=True).approved)
