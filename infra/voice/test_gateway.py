"""Run with gateway dependencies: python -m unittest test_gateway -v. No external calls."""
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("NOTIFIER_TOKEN", "test-only-token")
os.environ.setdefault("VOICE_DATA", tempfile.mkdtemp(prefix="gateway-import-"))
import gateway


class CallLimitTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.patch = patch.object(gateway, "DATA", Path(self.directory.name))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.env = patch.dict(os.environ, {"MAX_CALLS_PER_DAY": "3", "VOICE_TIMEZONE": "America/Chicago"})
        self.env.start()
        self.addCleanup(self.env.stop)
        with gateway.connect() as db:
            for index in range(3):
                db.execute("INSERT INTO calls(key,payload,room,status,created,dialed,updated) VALUES(?,?,?,'failed',?,?,?)",
                    (f"old-{index}", "{}", "old-room", time.time(), time.time(), time.time()))
            db.execute("INSERT INTO calls(key,payload,room,status,created,updated) VALUES(?,?,?,'queued',?,?)",
                ("new", json.dumps({"script": "test", "phone": "+12025550123"}), "new-room", time.time(), time.time()))

    async def test_exhausted_budget_is_explicit_and_does_not_connect_media(self):
        with patch.object(gateway, "client", side_effect=AssertionError("Should not connect")), \
             patch.object(gateway, "synthesize", new_callable=AsyncMock) as synthesize:
            await gateway.run("new")
        job = gateway.row("new")
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"], "Daily physical-call limit reached (3/3); resets at midnight America/Chicago")
        self.assertIsNone(job["dialed"])
        synthesize.assert_not_awaited()

    def test_atomic_reservation_keeps_existing_ledger(self):
        with self.assertRaisesRegex(RuntimeError, "Daily physical-call limit reached"):
            gateway.reserve_dial("new")
        self.assertIsNone(gateway.row("new")["dialed"])

    def test_test_dial_bypasses_full_budget_but_remains_in_journal(self):
        with gateway.connect() as db:
            db.execute("UPDATE calls SET is_test=1 WHERE key='new'")
        gateway.reserve_dial("new")
        self.assertIsNotNone(gateway.row("new")["dialed"])
        budget = gateway.call_budget()
        self.assertEqual(budget["used"], 3)
        self.assertEqual(budget["remaining"], 0)
        self.assertEqual(budget["test_calls"], 1)

    def test_reclassifying_existing_tests_restores_only_their_allowance(self):
        with gateway.connect() as db:
            db.execute("UPDATE calls SET is_test=1 WHERE key IN ('old-0','old-1')")
        gateway.reserve_dial("new")
        budget = gateway.call_budget()
        self.assertEqual(budget["used"], 2)
        self.assertEqual(budget["remaining"], 1)
        self.assertEqual(budget["test_calls"], 2)

    async def test_test_flag_is_persisted_and_cannot_change_on_replay(self):
        with patch.dict(os.environ, {"PHOTON_LINE": "+12025550000", "ALERT_PHONE": "+12025550123"}), \
             patch.object(gateway, "enqueue"):
            data = gateway.CallInput(key="explicit-test", phone="+12025550123", script="test", test_call=True)
            result = await gateway.create(data)
            self.assertTrue(result["test_call"])
            self.assertEqual(gateway.row("explicit-test")["is_test"], 1)
            self.assertEqual(await gateway.create(data), result)
            with self.assertRaises(gateway.HTTPException) as error:
                await gateway.create(data.model_copy(update={"test_call": False}))
            self.assertEqual(error.exception.status_code, 409)

    async def test_legacy_payload_remains_replayable(self):
        with patch.dict(os.environ, {"PHOTON_LINE": "+12025550000", "ALERT_PHONE": "+12025550123"}), \
             patch.object(gateway, "enqueue"):
            data = gateway.CallInput(key="new", phone="+12025550123", script="test")
            self.assertFalse((await gateway.create(data))["test_call"])

    async def test_voice_line_is_independent_of_the_message_sender(self):
        with patch.dict(os.environ, {"PHOTON_LINE": "+12025550000", "VOICE_PHOTON_LINE": "+12025550001",
                                     "ALERT_PHONE": "+12025550123"}), patch.object(gateway, "enqueue"):
            self.assertEqual(gateway.voice_line(), "+12025550001")
            lk = AsyncMock()
            lk.sip.list_sip_outbound_trunk.return_value.items = []
            lk.sip.create_sip_outbound_trunk.return_value.sip_trunk_id = "voice-trunk"
            with patch.dict(os.environ, {"PHOTON_SIP_ADDRESS": "sip.example.com:5061",
                                         "PHOTON_SIP_USERNAME": "test", "PHOTON_SIP_PASSWORD": "test"}):
                await gateway.trunk(lk)
            request = lk.sip.create_sip_outbound_trunk.call_args.args[0]
            self.assertEqual(list(request.trunk.numbers), ["+12025550001"])
            data = gateway.CallInput(key="split-lines", phone="+12025550123", script="test", test_call=True)
            await gateway.create(data)
            with self.assertRaises(gateway.HTTPException) as error:
                await gateway.create(data.model_copy(update={"phone": "+12025550001"}))
            self.assertEqual(error.exception.detail, "Recipient cannot be the originating Photon line")


if __name__ == "__main__":
    unittest.main()
