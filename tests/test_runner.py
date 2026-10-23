"""Checks for the consequential temporal and evidence-integrity boundaries."""
import copy
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from saty_dashboard.calendar import ET, aware_now, context, expected_bars, market_gate, previous_session, session_bounds
from saty_dashboard.providers import DataQualityError, MarketData, aggregate_3m, normalize, regular_completed
from saty_dashboard.runner import _signal, atomic_json, build_snapshot, failure_snapshot, initial_snapshot, record_journal, refresh, validate_inputs


NOW = "2026-10-23T10:02:00-04:00"


def market_fixture(now=NOW):
    session = context(now)
    day = date.fromisoformat(session["date"])
    dates = expected_bars(day - pd.Timedelta(days=10), day)
    times = dates[dates + pd.Timedelta(minutes=3) <= pd.Timestamp(now)]
    def candles(index):
        close = [500 + index_number * .008 + ((index_number % 9) - 4) * .025 for index_number in range(len(index))]
        return pd.DataFrame({"Open": close, "High": [x + .12 for x in close], "Low": [x - .12 for x in close],
                             "Close": close, "Volume": 1000.}, index=index)
    daily_index = pd.date_range(end=previous_session(day), periods=150, freq="B", tz=ET) + pd.Timedelta(hours=9, minutes=30)
    daily = candles(daily_index)
    return MarketData(daily, candles(times), None, {
        "provider": "FIXTURE", "symbol": "SPY", "interval": "3m", "baseline_compatible": False,
    }, ["OFFLINE FIXTURE"])


class CalendarTests(unittest.TestCase):
    def test_dst_open_is_not_fixed_utc(self):
        before, _ = session_bounds(date(2026, 3, 6))
        after, _ = session_bounds(date(2026, 3, 9))
        self.assertEqual(before.tz_convert("UTC").hour, 14)
        self.assertEqual(after.tz_convert("UTC").hour, 13)

    def test_holiday_gate(self):
        self.assertFalse(market_gate("2026-11-26T15:00:00Z")[0])

    def test_early_close_gate_and_finalizer(self):
        _, closed = session_bounds(date(2026, 11, 27))
        self.assertEqual(closed.hour, 13)
        self.assertTrue(market_gate("2026-11-27T13:12:00-05:00")[0])
        self.assertFalse(market_gate("2026-11-27T13:16:00-05:00")[0])

    def test_naive_timestamp_rejected(self):
        with self.assertRaises(ValueError):
            aware_now("2026-10-23T10:00:00")


class ProviderTests(unittest.TestCase):
    def test_partial_three_minute_bar_is_not_published(self):
        index = pd.date_range("2026-10-23 09:30", periods=5, freq="1min", tz=ET)
        frame = pd.DataFrame({"Open": 100., "High": 101., "Low": 99., "Close": 100., "Volume": 1.}, index=index)
        result = aggregate_3m(frame, "2026-10-23T09:35:00-04:00")
        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0].Volume, 3)

    def test_forming_native_bar_and_extended_session_removed(self):
        index = pd.date_range("2026-10-23 09:27", periods=4, freq="3min", tz=ET)
        frame = pd.DataFrame({"Open": 100., "High": 101., "Low": 99., "Close": 100., "Volume": 1.}, index=index)
        result = regular_completed(frame, "2026-10-23T09:35:00-04:00", 3)
        self.assertEqual(list(result.index.strftime("%H:%M")), ["09:30"])

    def test_ohlc_and_duplicate_data_fail_closed(self):
        data = market_fixture()
        bad = data.bars3.copy()
        bad.iloc[0, bad.columns.get_loc("High")] = 0
        with self.assertRaises(DataQualityError):
            normalize(bad)
        with self.assertRaises(DataQualityError):
            normalize(pd.concat([data.bars3, data.bars3.iloc[:1]]))


class RunnerTests(unittest.TestCase):
    def test_daily_reference_excludes_today(self):
        data = market_fixture()
        baseline = build_snapshot(data, NOW)
        row = data.daily.iloc[-1:].copy()
        row.index = pd.DatetimeIndex([pd.Timestamp("2026-10-23 09:30", tz=ET)])
        row.loc[:, ["Open", "High", "Low", "Close"]] = 9999
        data.daily = pd.concat([data.daily, row])
        changed = build_snapshot(data, NOW)
        self.assertEqual(baseline["market"]["prev_close"], changed["market"]["prev_close"])
        self.assertEqual(baseline["market"]["atr14"], changed["market"]["atr14"])

    def test_missing_bar_in_warmup_blocks_replay(self):
        data = market_fixture()
        data.bars3 = data.bars3.drop(data.bars3.index[-30])
        with self.assertRaisesRegex(DataQualityError, "Missing or misaligned"):
            validate_inputs(data, context(NOW), NOW)

    def test_missing_opening_bar_blocks_replay(self):
        data = market_fixture()
        data.bars3 = data.bars3.drop(pd.Timestamp("2026-10-23 09:30", tz=ET))
        with self.assertRaisesRegex(DataQualityError, "opening"):
            validate_inputs(data, context(NOW), NOW)

    def test_full_bar_close_asof_and_no_live_entry_claim(self):
        snap = build_snapshot(market_fixture(), NOW)
        self.assertEqual(pd.Timestamp(snap["health"]["price_asof"]).strftime("%H:%M"), "10:00")
        self.assertEqual(snap["health"]["state"], "CURRENT")
        self.assertGreater(len(snap["signals"]), 0, "Fixture must exercise actual signal serialization")
        self.assertTrue(all(s["eligibility"] == "HISTORICAL_REPLAY" for s in snap["signals"]))
        self.assertFalse(any(s["eligible_for_forward_entry_evaluation"] for s in snap["signals"]))
        json.dumps(snap, allow_nan=False)

    def test_completed_managed_exit_keeps_policy_and_unknown_time(self):
        event = {"status": "entered", "outcomes": ["TARGET_FIRST"], "setup": "trigger break", "cohort": "fresh",
                 "side": 1, "managed": True, "decision_time": pd.Timestamp("2026-10-23T09:39:00-04:00"),
                 "bar_open": pd.Timestamp("2026-10-23T09:36:00-04:00"), "entry_time": pd.Timestamp("2026-10-23T09:39:00-04:00"),
                 "entry": 100., "stop": 99., "risk": 1., "risk_atr": .1, "signal_close": 100., "targets": [("T1", 101.)],
                 "target_R": [1.], "managed_exit": {"why": "stop/34EMA close", "exit": 100.5, "R": .5}}
        result = _signal(event, aware_now("2026-10-23T16:02:00-04:00"), context("2026-10-23T16:02:00-04:00"), None, False)
        self.assertEqual(result["exit"], {"reason": "Managed policy: stop/34EMA close", "price": 100.5, "at": None})
        self.assertEqual(result["targets"][0]["outcome"], "TARGET_FIRST")
        self.assertFalse(result["eligible_for_forward_entry_evaluation"])

    def test_forming_bar_does_not_change_snapshot(self):
        data = market_fixture()
        before = build_snapshot(data, NOW)
        later = data.bars3.iloc[-1:].copy()
        later.index = later.index + pd.Timedelta(minutes=3)
        later.loc[:, ["Open", "High", "Low", "Close"]] = 999
        data.bars3 = pd.concat([data.bars3, later])
        after = build_snapshot(data, NOW)
        self.assertEqual(before, after)

    def test_closed_session_without_closing_bar_is_stale_not_timeout(self):
        now = "2026-10-23T16:02:00-04:00"
        data = market_fixture(now)
        data.bars3 = data.bars3.iloc[:-1]
        snapshot = build_snapshot(data, now)
        self.assertEqual(snapshot["health"]["state"], "STALE")
        self.assertEqual(snapshot["plan"]["state"], "DATA_HOLD")
        self.assertFalse(any(t["outcome"] == "TIMEOUT" for s in snapshot["signals"] for t in s["targets"]))

    def test_failure_preserves_price_timestamp_and_disables_plan(self):
        prior = build_snapshot(market_fixture(), NOW)
        failed = failure_snapshot(prior, "2026-10-23T10:15:00-04:00", TimeoutError())
        self.assertEqual(prior["health"]["price_asof"], failed["health"]["price_asof"])
        self.assertEqual(failed["plan"]["state"], "DATA_HOLD")
        self.assertEqual(failed["health"]["state"], "STALE")
        self.assertNotEqual(prior["generated_at"], failed["generated_at"])

    def test_first_observation_is_immutable_and_outcomes_separate(self):
        snapshot = build_snapshot(market_fixture(), NOW)
        # Construct a simple episode so this audit does not depend on fixture strategy behavior.
        episode = {"id": "known-event", "entry": 100., "stop": 99., "entry_at": "2026-10-23T09:39:00-04:00",
                   "risk": 1., "status": "TRACKING", "note": "fixture", "observed_at": snapshot["generated_at"],
                   "targets": [{"label": "T1", "price": 101., "rr": 1., "outcome": "UNKNOWN", "probability": {}}]}
        snapshot["signals"] = [episode]
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            record_journal(snapshot, directory)
            original = (directory / "2026-10-23/observations.jsonl").read_text()
            changed = copy.deepcopy(snapshot)
            changed["generated_at"] = "2026-10-23T14:12:00+00:00"
            changed["signals"][0]["status"] = "CLOSED"
            changed["signals"][0]["targets"][0]["outcome"] = "TARGET_FIRST"
            record_journal(changed, directory)
            self.assertEqual(original, (directory / "2026-10-23/observations.jsonl").read_text())
            self.assertEqual(len((directory / "2026-10-23/outcomes.jsonl").read_text().splitlines()), 2)
            self.assertEqual(changed["signals"][0]["observed_at"], snapshot["generated_at"])

    def test_crash_lost_index_does_not_duplicate_first_observation(self):
        snapshot = build_snapshot(market_fixture(), NOW)
        self.assertGreater(len(snapshot["signals"]), 0)
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            record_journal(snapshot, directory)
            original = (directory / "2026-10-23/observations.jsonl").read_text()
            (directory / "index.json").unlink()  # Simulate append surviving an interrupted index save.
            retry = copy.deepcopy(snapshot)
            retry["generated_at"] = "2026-10-23T14:12:00+00:00"
            for signal in retry["signals"]:
                signal["observed_at"] = retry["generated_at"]
            record_journal(retry, directory)
            self.assertEqual(original, (directory / "2026-10-23/observations.jsonl").read_text())
            self.assertTrue(all(signal["observed_at"] == snapshot["generated_at"] for signal in retry["signals"]))
            recovered = json.loads((directory / "index.json").read_text())
            self.assertEqual(len(recovered["events"]), len(snapshot["signals"]))

    def test_missing_replay_event_withdrawal_and_restoration_are_audited(self):
        snapshot = build_snapshot(market_fixture(), NOW)
        self.assertGreater(len(snapshot["signals"]), 0)
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            record_journal(snapshot, directory)
            missing = copy.deepcopy(snapshot)
            missing["signals"] = []
            missing["generated_at"] = "2026-10-23T14:12:00+00:00"
            record_journal(missing, directory)
            record_journal(missing, directory)  # Normal retry must not repeat withdrawal.
            revisions = [json.loads(line) for line in (directory / "2026-10-23/revisions.jsonl").read_text().splitlines()]
            self.assertEqual(sum(row["kind"] == "REPLAY_EVENT_WITHDRAWN" for row in revisions), len(snapshot["signals"]))
            restored = copy.deepcopy(snapshot)
            restored["generated_at"] = "2026-10-23T14:22:00+00:00"
            record_journal(restored, directory)
            revisions = [json.loads(line) for line in (directory / "2026-10-23/revisions.jsonl").read_text().splitlines()]
            self.assertEqual(sum(row["kind"] == "REPLAY_EVENT_RESTORED" for row in revisions), len(snapshot["signals"]))

    def test_real_refresh_observation_time_is_after_feed_receipt(self):
        clocks = iter([aware_now("2026-10-23T10:01:00-04:00"), aware_now(NOW)])
        def clock(value=None):
            return aware_now(value) if value is not None else next(clocks)
        with tempfile.TemporaryDirectory() as name:
            output = Path(name) / "latest.json"
            with patch("saty_dashboard.runner.aware_now", side_effect=clock), patch(
                    "saty_dashboard.runner.fetch_market_data", return_value=market_fixture()):
                success = refresh(output, Path(name) / "state")
            self.assertTrue(success)
            snapshot = json.loads(output.read_text())
            self.assertEqual(snapshot["generated_at"], aware_now(NOW).isoformat())
            self.assertEqual(snapshot["health"]["request_started_at"], "2026-10-23T14:01:00+00:00")
            self.assertTrue(all(signal["observed_at"] == snapshot["generated_at"] for signal in snapshot["signals"]))

    def test_real_refresh_failure_time_is_after_failed_fetch(self):
        clocks = iter([aware_now("2026-10-23T10:01:00-04:00"), aware_now(NOW)])
        def clock(value=None):
            return aware_now(value) if value is not None else next(clocks)
        with tempfile.TemporaryDirectory() as name:
            output = Path(name) / "latest.json"
            with patch("saty_dashboard.runner.aware_now", side_effect=clock), patch(
                    "saty_dashboard.runner.fetch_market_data", side_effect=TimeoutError()):
                success = refresh(output, Path(name) / "state")
            self.assertFalse(success)
            snapshot = json.loads(output.read_text())
            self.assertEqual(snapshot["health"]["last_attempt_at"], aware_now(NOW).isoformat())

    def test_failed_fetch_writes_hold_and_returns_failure(self):
        with tempfile.TemporaryDirectory() as name:
            output = Path(name) / "latest.json"
            with patch("saty_dashboard.runner.fetch_market_data", side_effect=TimeoutError()):
                success = refresh(output, Path(name) / "state", NOW)
            self.assertFalse(success)
            snapshot = json.loads(output.read_text())
            self.assertEqual(snapshot["health"]["state"], "UNAVAILABLE")
            self.assertIsNone(snapshot["market"]["last"])


if __name__ == "__main__":
    unittest.main()
