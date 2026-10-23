"""Check that the visible learning state cannot silently activate several rules."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("summarize_learning", ROOT / "scripts/summarize_learning.py")
learning = importlib.util.module_from_spec(spec)
spec.loader.exec_module(learning)


class LearningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.candidate = json.loads((ROOT / "learning/candidates.jsonl").read_text().splitlines()[0])
        self.write([self.candidate], [])

    def write(self, candidates, challengers):
        for name, rows in (("candidates", candidates), ("challengers", challengers)):
            (self.path / f"{name}.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

    def challenger(self, candidate=None):
        record = json.loads((ROOT / "learning/templates/challenger.json").read_text())
        for name, value in list(record.items()):
            if value is None:
                record[name] = "registered-plan"
        record.update(record_id="test-001", candidate_id=candidate or self.candidate["candidate_id"],
                      recorded_at="2026-10-23T15:00:00-04:00", status="SHADOW", supersedes_record_id=None)
        return record

    def test_registry_is_deterministic_and_does_not_invent_evidence(self):
        result = learning.summarize(self.path)
        self.assertEqual(result, learning.summarize(self.path))
        self.assertEqual(result["candidate_count"], 1)
        self.assertIsNone(result["active_challenger"])
        self.assertFalse(result["promotion"]["automatic"])
        self.assertNotIn("probability", json.dumps(result))

    def test_two_active_challengers_fail_even_with_different_statuses(self):
        other = copy.deepcopy(self.candidate)
        other.update(candidate_id="OTHER", record_id="other-001")
        first, second = self.challenger(), self.challenger("OTHER")
        second.update(record_id="second-001", status="REGISTERED")
        self.write([self.candidate, other], [first, second])
        with self.assertRaisesRegex(ValueError, "Only one"):
            learning.summarize(self.path)

    def test_superseding_record_replaces_status_without_erasing_history(self):
        first = self.challenger()
        second = {**first, "record_id": "test-002", "supersedes_record_id": "test-001", "status": "RETIRED"}
        self.write([self.candidate], [first, second])
        result = learning.summarize(self.path)
        self.assertIsNone(result["active_challenger"])
        self.assertEqual(result["candidates"][0]["status"], "RETIRED")

    def test_promotion_requires_review_floor_and_review_record(self):
        record = self.challenger()
        record["status"] = "PROMOTED"
        self.write([self.candidate], [record])
        with self.assertRaisesRegex(ValueError, "review floor"):
            learning.summarize(self.path)
        record["results"].update(sessions=30, eligible_episodes=100)
        record["promotion_pr"] = None
        self.write([self.candidate], [record])
        with self.assertRaisesRegex(ValueError, "promotion_pr"):
            learning.summarize(self.path)

    def test_incomplete_registration_and_private_source_are_rejected(self):
        record = self.challenger()
        record["baseline_commit"] = None
        self.write([self.candidate], [record])
        with self.assertRaisesRegex(ValueError, "incomplete frozen plan"):
            learning.summarize(self.path)
        self.candidate["source"]["public_safe"] = False
        self.write([self.candidate], [])
        with self.assertRaisesRegex(ValueError, "publishable"):
            learning.summarize(self.path)

    def test_duplicate_record_id_cannot_rewrite_candidate(self):
        self.write([self.candidate, self.candidate], [])
        with self.assertRaisesRegex(ValueError, "duplicate record ID"):
            learning.summarize(self.path)

    def test_candidate_cannot_claim_shadow_status_without_a_frozen_plan(self):
        self.candidate["status"] = "SHADOW"
        self.write([self.candidate], [])
        with self.assertRaisesRegex(ValueError, "no frozen challenger plan"):
            learning.summarize(self.path)


if __name__ == "__main__":
    unittest.main()
