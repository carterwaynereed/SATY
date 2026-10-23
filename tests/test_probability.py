"""Meaningful evidence-gate and denominator tests, without a market connection."""
import copy
from datetime import date, timedelta
import json
from pathlib import Path
import unittest

from saty_dashboard.probability import EvidenceModel, attach_probability, rr_bucket, wilson

ROOT = Path(__file__).resolve().parents[1]


def sample(count=25):
    obs = []
    for i in range(count):
        day = (date(2026, 9, 1) + timedelta(days=i % 25)).isoformat()
        # Correlated T1/T2 rows must never be counted as 2 signals for T1.
        for j in (0, 1):
            obs.append({"setup": "test", "cohort": "fresh", "j": j, "b": "1-2R",
                        "r": 1.5, "y": int(j == 0 and i % 2 == 0),
                        "y_tf": int(j == 0 and i % 2 == 0), "amb": 0, "to": int(i == 1), "day": day})
    return {"version": "saty-sig-2.0", "days": ["2026-09-01", "2026-09-30"],
            "built": "2026-10-01T12:00:00-04:00", "n_days": 25, "obs": obs}


class ProbabilityTests(unittest.TestCase):
    def setUp(self):
        self.model = EvidenceModel(sample())

    def card(self, **kwargs):
        args = dict(setup="test", cohort="fresh", target_index=1, rr=1.5,
                    decision_at="2026-10-02T09:39:00-04:00", source_compatible=True)
        args.update(kwargs)
        return self.model.for_target(**args)

    def test_empty_denominator_is_unavailable_not_zero(self):
        result = self.card(setup="absent")
        self.assertEqual((result["hits"], result["n"], result["sessions"]), (0, 0, 0))
        self.assertIsNone(result["raw_rate"])
        self.assertIsNone(result["interval"])
        self.assertIsNone(result["display_probability"])

    def test_exact_target_counts_do_not_pool_correlated_targets(self):
        first = self.card()
        second = self.card(target_index=2)
        self.assertEqual((first["hits"], first["n"]), (13, 25))
        self.assertEqual((second["hits"], second["n"]), (0, 25))
        self.assertEqual(first["sessions"], 25)
        self.assertEqual(first["episodes"], 25)
        self.assertIsNone(first["independent_episodes"])
        self.assertAlmostEqual(first["display_probability"], 13 / 25)
        self.assertEqual(second["display_probability"], 0)

    def test_cohort_and_rr_bucket_are_exact(self):
        self.assertEqual(self.card(cohort="late/gap")["n"], 0)
        self.assertEqual(self.card(rr=3.0)["n"], 0)
        self.assertEqual([rr_bucket(x) for x in [.49, .5, 1., 2., 4.]],
                         ["<0.5R", "0.5-1R", "1-2R", "2-4R", ">4R"])

    def test_thin_cells_keep_counts_but_hide_headline(self):
        self.model = EvidenceModel(sample(19))
        result = self.card()
        self.assertEqual(result["n"], 19)
        self.assertIsNotNone(result["raw_rate"])
        self.assertIsNone(result["display_probability"])
        self.assertIn("Thin exact cell", result["reason"])

    def test_source_mismatch_hides_headline(self):
        result = self.card(source_compatible=False)
        self.assertIsNone(result["display_probability"])
        self.assertIn("not verified comparable", result["reason"])
        wrapped = attach_probability("test", "fresh", 1, 1.5, self.model,
                                     "2026-10-02T09:39:00-04:00", provider="TradingView")
        self.assertIsNone(wrapped["display_probability"], "Provider name alone is insufficient")

    def test_training_must_precede_session_not_only_time(self):
        result = self.card(decision_at="2026-09-30T16:30:00-04:00")
        self.assertIsNone(result["display_probability"])
        self.assertIn("not strictly before", result["reason"])

    def test_evidence_must_exist_at_decision_time(self):
        result = self.card(decision_at="2026-10-01T11:59:00-04:00")
        self.assertIsNone(result["display_probability"])
        self.assertIn("not available", result["reason"])
        self.assertIsNotNone(self.card(decision_at="2026-10-01T16:01:00Z")["display_probability"])

    def test_missing_naive_and_bad_times_are_not_assumed_safe(self):
        for decision in (None, "2026-10-02T09:39:00", "tomorrow"):
            self.assertIsNone(self.card(decision_at=decision)["display_probability"])

    def test_unknown_risk_does_not_select_zero_risk_bucket(self):
        for rr in (None, 0, -1, float("nan"), float("inf"), True):
            result = self.card(rr=rr)
            self.assertIsNone(result["rr_bucket"])
            self.assertIsNone(result["display_probability"])
            json.dumps(result, allow_nan=False)

    def test_wilson_interval_is_count_based_and_zero_safe(self):
        self.assertIsNone(wilson(0, 0))
        lo, hi = wilson(5, 10)
        self.assertAlmostEqual(lo, .23659309, places=6)
        self.assertAlmostEqual(hi, .76340691, places=6)
        self.assertEqual(wilson(0, 10)[0], 0)
        with self.assertRaises(ValueError):
            wilson(11, 10)

    def test_supplied_summary_reconciles_without_calling_it_a_holdout(self):
        evidence = EvidenceModel(ROOT / "stats/signal_stats_v2.json").summary()
        fresh = next(x for x in evidence["cohorts"] if x["setup"] == "trigger break" and x["cohort"] == "fresh")
        # Supplied summary says 14 candidate sessions, including a cancellation.
        # The denominator's entered/resolved T1 observations occupy 13 sessions.
        self.assertEqual((fresh["t1"]["hits"], fresh["t1"]["n"], fresh["sessions"]), (6, 18, 13))
        self.assertEqual(evidence["evidence_state"], "DEVELOPMENT")
        self.assertEqual(evidence["calibration"]["state"], "EXPLORATORY_LEGACY_MODEL")
        self.assertEqual(evidence["forward"]["validated_sessions"], 0)

    def test_stats_hash_and_summary_are_deterministic_and_read_only(self):
        data = sample()
        original = copy.deepcopy(data)
        model = EvidenceModel(data)
        self.assertEqual(model.stats_id, EvidenceModel(data).stats_id)
        self.assertEqual(model.summary(), model.summary())
        self.assertEqual(data, original)

    def test_training_range_mismatch_fails_closed(self):
        data = sample()
        data["obs"][0]["day"] = "2026-10-15"
        with self.assertRaises(ValueError):
            EvidenceModel(data)

    def test_no_unvalidated_smoothed_estimate_is_published(self):
        result = self.card()
        self.assertIsNone(result["estimate"])
        self.assertIn("No validated forecast", result["estimate_label"])


if __name__ == "__main__":
    unittest.main()
