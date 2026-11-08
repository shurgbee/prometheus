"""These policy tests also run without dependencies: PYTHONPATH=backend python -m unittest discover -s tests -p test_policy.py."""
import math
import unittest

from finance_hub.policy import cd_value, score_signal


class SeverityPolicyTests(unittest.TestCase):
    def test_band_boundaries(self):
        self.assertEqual(score_signal(0, 0, 0, 0, 0, True), (0, "OK"))
        self.assertEqual(score_signal(1, .02, 0, 0, 0, True), (40, "Normal"))
        self.assertEqual(score_signal(1, .08, 1, 0, 0, True), (75, "Critical"))

    def test_critical_requires_magnitude_capability_and_exposure_or_pin(self):
        self.assertEqual(score_signal(.59, 1, 1, 1, 15, True)[1], "Normal")
        self.assertEqual(score_signal(1, 1, 1, 1, 15, False)[1], "Normal")
        self.assertEqual(score_signal(1, .004, 1, 1, 15, True)[1], "Normal")
        self.assertEqual(score_signal(1, 0, 1, 1, 15, True, pinned=True)[1], "Critical")
        self.assertEqual(score_signal(1, .005, 1, 1, 15, True)[1], "Critical")

    def test_weights_use_exposure_normalized_at_ten_percent(self):
        self.assertEqual(score_signal(.4, .04, 1, .2, 0, True), (48, "Normal"))
        self.assertEqual(score_signal(1, .04, 1, 1, 0, True), (85, "Critical"))
        self.assertEqual(score_signal(0, .5, 0, 0, 0, False), (25, "OK"))

    def test_model_adjustment_and_inputs_are_bounded(self):
        self.assertEqual(score_signal(0, 0, 0, 0, 1000, False), (15, "OK"))
        self.assertEqual(score_signal(0, 0, 0, 0, -1000, False), (0, "OK"))
        self.assertEqual(score_signal(100, 100, 100, 100, 100, True), (100, "Critical"))
        for invalid in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValueError):
                score_signal(invalid, 0, 0, 0, 0, False)

    def test_cd_daily_compounding_and_future_start(self):
        self.assertEqual(cd_value(10000, .05, -1), 10000)
        self.assertEqual(cd_value(10000, 0, 365), 10000)
        self.assertAlmostEqual(cd_value(10000, .05, 365), 10512.674964674473)


if __name__ == "__main__":
    unittest.main()
