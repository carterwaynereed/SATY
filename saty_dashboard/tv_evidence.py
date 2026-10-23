"""Feed-specific, reproducible development replay of the frozen SATY rules.

The existing 34-session artifact remains untouched. This rebuild establishes
which public TradingView source actually supplied each ticker's OHLC bars.
Every result remains DEVELOPMENT evidence, never an untouched test forecast.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from hashlib import sha256
import json
import math
from pathlib import Path
import sys
from typing import Mapping

import pandas as pd

from .calendar import ET, aware_now, expected_bars, is_session, previous_session, session_bounds
from .probability import MIN_DISPLAY_N, rr_bucket, wilson
from .providers import COLUMNS, DataQualityError, normalize, regular_completed

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import engine as engine  # noqa: E402
import sig2  # noqa: E402

SYMBOLS = {"SPY": ["AMEX:SPY"], "SPX": ["TVC:SPX", "SP:SPX"],
           "AAPL": ["NASDAQ:AAPL"], "GOOGL": ["NASDAQ:GOOGL"]}
EVENT = "T_i touched before ORIGINAL stop by 16:00 ET; decision at confirmed 3m close, modeled entry at next 3m open"
METHOD = ("Same-symbol, same-source TradingView regular-session replay of frozen saty-sig-2.0. "
          "Exact setup + cohort + target index + reward/risk bucket; raw descriptive frequency and Wilson 95% interval. "
          "All intrabar ambiguity uses 3m stop-first consistently; target-first sensitivity is reported. No fitted forecast.")


def canonical_bytes(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def source_identity(tv_symbol: str, metadata: Mapping) -> dict:
    """Shared with the live JS adapter; source metadata, not brand name, matches."""
    identity = {"provider": "TradingView", "symbol": tv_symbol,
                "source_id": metadata.get("source_id"), "pro_name": metadata.get("pro_name") or tv_symbol,
                "session_basis": "RTH", "interval": "3m", "adjustment": "splits"}
    return {**identity, "fingerprint": "sha256:" + sha256(canonical_bytes(identity)).hexdigest()}


def frame_from_values(values: Mapping, daily: bool = False) -> tuple[pd.DataFrame, bool]:
    """No-volume indices retain an explicit missing-volume flag, not fabricated trades."""
    if not values:
        raise DataQualityError("TradingView returned no bars")
    stamps = sorted(float(t) for t in values)
    lookup = {float(t): row for t, row in values.items()}
    has_volume = all(len(lookup[t]) >= 5 and lookup[t][4] is not None for t in stamps)
    rows = [list(lookup[t][:4]) + [lookup[t][4] if len(lookup[t]) >= 5 and lookup[t][4] is not None else 0.0]
            for t in stamps]
    frame = pd.DataFrame(rows, index=pd.to_datetime(stamps, unit="s", utc=True).tz_convert(ET), columns=COLUMNS)
    return normalize(frame, daily=daily), has_volume


def eligible_sessions(daily: pd.DataFrame, bars3: pd.DataFrame, now) -> tuple[list[date], list[dict]]:
    """Require full 16:00 sessions, causal D-1 references and continuous warmup."""
    clock = aware_now(now).astimezone(ET)
    accepted, excluded = [], []
    for day in sorted(set(bars3.index.date)):
        reason = None
        if day >= clock.date():
            reason = "Current/future session excluded from development training"
        elif not is_session(day):
            reason = "Not an exchange session"
        else:
            opened, closed = session_bounds(day)
            today = bars3[bars3.index.date == day]
            expected = expected_bars(day, day)
            prior = bars3[bars3.index.date < day].iloc[-engine.WARM:]
            daily_prior = daily[daily.index.date < day]
            if closed.hour != 16 or closed.minute != 0:
                reason = "Early-close horizon differs from the 16:00 event"
            elif not today.index.equals(expected):
                reason = "Missing or misaligned bars in the full RTH session"
            elif len(prior) != engine.WARM:
                reason = "Fewer than 400 prior warmup bars"
            elif len(daily_prior) < 100 or daily_prior.index[-1].date() != previous_session(day):
                reason = "Missing/stale completed daily reference or insufficient ATR warmup"
            else:
                warm_expected = expected_bars(prior.index[0].date(), prior.index[-1].date())
                warm_expected = warm_expected[(warm_expected >= prior.index[0]) & (warm_expected <= prior.index[-1])]
                if not prior.index.equals(warm_expected):
                    reason = "Gap in the 400-bar prior-session warmup"
        if reason:
            excluded.append({"date": day.isoformat(), "reason": reason})
        else:
            accepted.append(day)
    return accepted, excluded


def episode_id(ticker: str, event: Mapping, day: date) -> str:
    key = "|".join([sig2.VERSION, ticker, str(day), event["setup"], event.get("cohort", "all"),
                    str(event["side"]), event["decision_time"].isoformat()])
    return sha256(key.encode()).hexdigest()[:20]


def _counts(rows: list[dict]) -> dict:
    n, hits = len(rows), sum(r["y"] for r in rows)
    return {"hits": hits, "n": n, "episodes": len({r["episode_id"] for r in rows}),
            "sessions": len({r["day"] for r in rows}), "rate": hits / n if n else None,
            "interval": wilson(hits, n), "ambiguous": sum(r["amb"] for r in rows),
            "timeouts": sum(r["to"] for r in rows),
            "target_first_sensitivity": sum(r["y_tf"] for r in rows) / n if n else None}


def build_evidence(ticker: str, tv_symbol: str, daily: pd.DataFrame, bars3: pd.DataFrame,
                   metadata: Mapping, now, volume_available: bool = True) -> tuple[dict, dict]:
    if ticker not in SYMBOLS or tv_symbol not in SYMBOLS[ticker]:
        raise ValueError("Ticker and TradingView symbol do not match")
    clock = aware_now(now)
    daily = normalize(daily, daily=True)
    bars3 = regular_completed(bars3, clock, 3)
    days, excluded = eligible_sessions(daily, bars3, clock)
    identity = source_identity(tv_symbol, metadata)
    ledger, observations = [], []
    for day in days:
        pc, atr, levels = engine.levels_for(daily, day)
        events, _, today, indicators = sig2.replay(bars3, levels, atr, day)
        for event in events:
            if event["kind"] != "ENTRY":
                continue
            e = sig2.evaluate(event, today, indicators, complete=True, m1=None)
            ident = episode_id(ticker, e, day)
            record = {"episode_id": ident, "symbol": ticker, "tv_symbol": tv_symbol,
                      "session_date": day.isoformat(), "setup": e["setup"], "cohort": e.get("cohort", "all"),
                      "side": "LONG" if e["side"] == 1 else "SHORT", "decision_at": e["decision_time"].isoformat(),
                      "bar_at": e["bar_open"].isoformat(), "status": e["status"], "signal_close": e["signal_close"],
                      "entry_at": e["entry_time"].isoformat() if e.get("entry_time") is not None else None,
                      "entry": e.get("entry"), "original_stop": e["stop"], "targets": e["targets"],
                      "target_R": e.get("target_R", []), "daily_atr": atr, "prev_close": pc,
                      "daily_reference": previous_session(day).isoformat(), "outcomes": e.get("outcomes", []),
                      "outcomes_target_first": e.get("outcomes_tf", []), "ambiguous": e.get("amb", []),
                      "cancel_reason": e.get("cancel_reason"), "tiny_risk": e.get("tiny_risk", False)}
            ledger.append(record)
            if e["status"] != "entered":
                continue
            for j, result in enumerate(e["outcomes"]):
                if result == "UNKNOWN":
                    continue
                observations.append({"episode_id": ident, "day": day.isoformat(), "side": record["side"],
                                     "setup": record["setup"], "cohort": record["cohort"], "target_index": j + 1,
                                     "rr_bucket": rr_bucket(e["target_R"][j]), "rr": e["target_R"][j],
                                     "y": int(result == "TARGET_FIRST"), "y_tf": int(e["outcomes_tf"][j] == "TARGET_FIRST"),
                                     "amb": int(e["amb"][j]), "to": int(result == "TIMEOUT")})
    cells, cohorts = defaultdict(list), defaultdict(list)
    for row in observations:
        cells[(row["setup"], row["cohort"], row["target_index"], row["rr_bucket"])].append(row)
        if row["target_index"] == 1:
            cohorts[(row["setup"], row["cohort"])].append(row)
    cell_rows = [{"setup": key[0], "cohort": key[1], "target_index": key[2], "rr_bucket": key[3],
                  **_counts(rows)} for key, rows in sorted(cells.items())]
    cohort_rows = []
    for key, rows in sorted(cohorts.items()):
        summary = _counts(rows)
        candidates = [e for e in ledger if (e["setup"], e["cohort"]) == key]
        cohort_rows.append({"setup": key[0], "cohort": key[1], "episodes": summary["episodes"],
                            "sessions": summary["sessions"], "candidate_sessions": len({e["session_date"] for e in candidates}),
                            "independent_episodes": None, "t1": summary,
                            "cancelled": sum(e["status"] != "entered" for e in candidates),
                            "ambiguous": summary["ambiguous"], "timeouts": summary["timeouts"]})
    audit = {"schema_version": 1, "strategy_version": sig2.VERSION, "symbol": ticker,
             "source": identity, "built": clock.isoformat(), "training_sessions": [str(d) for d in days],
             "excluded_sessions": excluded, "ledger": ledger, "observations": observations}
    stats_id = "sha256:" + sha256(canonical_bytes(audit)).hexdigest()
    limits = [
        "Development replay only; no independent holdout, calibration or forward validation is claimed.",
        "Both directions share a cell; overlapping episodes within the same session are correlated. Wilson is descriptive and can understate uncertainty.",
        "Cell n counts one named target per episode. Other target indexes are never pooled into that denominator.",
        "Only complete 16:00 ET sessions strictly before the build date are eligible, after 400 continuous prior 3m bars and at least 100 prior daily bars.",
        "Uniform 3m stop-first treatment avoids mixing the limited 1m history with older observations. Target-first ambiguity sensitivity is retained.",
        "RR buckets and setup definitions are existing development choices, not newly selected on an untouched holdout.",
        "No option payoff, execution, commissions or slippage probability. ATR/ribbon use regular-session data; the RTH 13/48 basis is explicit.",
        "The public chart endpoint is unofficial and can return fewer bars than requested. Source parity means the same observed source identity, not an exchange-certified quote guarantee.",
    ]
    if not volume_available:
        limits.append("Index volume is absent. No VWAP evidence is inferred from zero-volume placeholders; SATY price-only replay is unaffected.")
    output = {"schema_version": 2, "symbol": ticker, "tv_symbol": tv_symbol, "stats_id": stats_id,
              "strategy_version": sig2.VERSION, "evidence_state": "DEVELOPMENT", "built": clock.isoformat(),
              "available_at": clock.isoformat(), "source": identity, "source_metadata": dict(metadata),
              "training_from": days[0].isoformat() if days else None,
              "training_to": days[-1].isoformat() if days else None, "sessions": len(days),
              "event_definition": EVENT, "method": METHOD, "interval_method": "Wilson 95% (descriptive; sessions correlated)",
              "minimum_headline_n": MIN_DISPLAY_N, "volume_available": volume_available,
              "cohorts": cohort_rows, "cells": cell_rows, "limitations": limits,
              "replay": {"engine_unchanged": True, "entry": "next completed 3m bar open",
                         "barrier": "original frozen stop and targets", "intrabar": "3m stop-first",
                         "one_minute_resolution": False, "early_close_sessions_included": False,
                         "ledger_episodes": len(ledger), "resolved_target_events": len(observations)},
              "forward": {"state": "COLLECTING", "validated_sessions": 0, "validated_episodes": 0},
              "excluded_sessions": excluded}
    return output, audit


def parity_reference(history: Mapping, audit: Mapping) -> dict:
    """Small frozen-Python references; raw input bars live in the gzip archive."""
    daily, _ = frame_from_values(history["daily"], daily=True)
    bars, _ = frame_from_values(history["bars3"])
    bars = regular_completed(bars, history["captured_at"], 3)
    current = bars.index[-1].date().isoformat()
    days = list(audit["training_sessions"])
    if current not in days:
        days.append(current)
    cases, current_entries = [], []
    for day_string in days:
        day = date.fromisoformat(day_string)
        pc, atr, levels = engine.levels_for(daily, day)
        events, strategy, today, indicators = sig2.replay(bars, levels, atr, day)
        _, closed = session_bounds(day)
        complete = today.index[-1] + pd.Timedelta(minutes=3) == closed
        cases.append({"day": day_string, "pc": pc, "atr": atr, "last_indicators": indicators[today.index[-1]],
                      "squeeze": strategy._squeeze(), "complete": complete})
        if day_string == current:
            for event in events:
                if event["kind"] != "ENTRY":
                    continue
                e = sig2.evaluate(event, today, indicators, complete=complete, m1=None)
                item = {k: e.get(k) for k in ["setup", "cohort", "side", "signal_close", "stop", "targets",
                        "status", "entry", "target_R", "outcomes", "amb"]}
                item.update(decision_time=e["decision_time"].isoformat(), bar_open=e["bar_open"].isoformat())
                current_entries.append(item)
    return {"captured_at": history["captured_at"], "cases": cases, "current_day": current,
            "current_entries": current_entries}
