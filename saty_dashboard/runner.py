"""Causal dashboard adapter around the unchanged supplied saty-sig-2.0 engine.

This is a periodically observed replay, not an executable next-open signal feed.
First observations and later outcome revisions are recorded separately.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from .calendar import aware_now, context, expected_bars, previous_session
from .providers import COLUMNS, DataQualityError, MarketData, fetch_market_data, normalize, regular_completed

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import engine as legacy_engine  # noqa: E402
import sig2  # noqa: E402

STRATEGY = {
    "version": sig2.VERSION, "name": "Saty SPY · frozen development baseline", "session_basis": "RTH",
    "notes": ["The supplied 13/48 ribbon uses RTH closes; the audit reports a difference from Saty's extended-session ribbon.",
              "Rules use bar-open windows; decisions are at confirmed 3m closes and modeled entries at the next 3m open.",
              "Managed trigger/GG pullback/re-entry windows: bar open >=09:35 and <11:30, or >=15:00 and <15:30 ET.",
              "Golden Gate open/ribbon flip context and squeeze windows: bar open >=09:35 and <15:30 ET.",
              "Golden Gate open and ribbon flip are context detectors; they are separate from managed strategy entries."],
}
FOOTNOTES = [
    "Signal and decision support only. No orders, brokerage connection, or option-return forecasts.",
    "GitHub Actions refreshes nominally every 10 minutes and may run late. A completed-bar replay is not a live quote or timely entry alert.",
    "Target evidence concerns touching a frozen target before the ORIGINAL stop by the session close; managed exits use a separate policy.",
    "No transaction costs or fills are modeled. Unresolved same-bar stop/target order is conservatively stop-first.",
    "The 34-session development sample and its post-hoc RR buckets are exploratory, not validated forward probabilities.",
]


def clean(value):
    """Strict JSON numbers and bounded precision; unknown values remain null."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [clean(v) for v in value]
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        return round(value, 6) if math.isfinite(value) else None
    if hasattr(value, "item"):
        return clean(value.item())
    return value


def atomic_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(clean(value), handle, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def initial_snapshot(now=None) -> dict:
    clock = aware_now(now)
    try:
        session = context(clock)
    except Exception:
        session = {"date": None, "status": "CLOSED", "open": None, "close": None,
                   "timezone": "America/New_York", "refresh_minutes": 10}
    return {
        "schema_version": 1, "generated_at": clock.isoformat(), "snapshot_id": None,
        "strategy": copy.deepcopy(STRATEGY), "session": session,
        "health": {"state": "UNAVAILABLE", "reason": "Awaiting the first successful scheduled data refresh.",
                   "price_asof": None, "age_seconds": None, "ttl_seconds": 900, "history_complete": False,
                   "warnings": [], "source": {"provider": None, "symbol": "SPY", "interval": "3m",
                                               "delay_seconds": None, "realtime": None}},
        "market": {"symbol": "SPY", "last": None, "prev_close": None, "atr14": None, "change": None,
                   "change_atr": None, "vwap": None, "day_high": None, "day_low": None},
        "levels": [], "bars": [], "signals": [],
        "ribbon": {"ema8": None, "ema13": None, "ema21": None, "ema34": None, "ema48": None,
                   "alignment": "UNAVAILABLE", "conviction": "UNAVAILABLE", "price_position": "UNAVAILABLE",
                   "phase": None, "phase_slope": None, "squeeze": None},
        "plan": {"state": "DATA_HOLD", "summary": "No current market snapshot is available.",
                 "next_conditions": [], "conflicts": []},
        "footnotes": FOOTNOTES.copy(),
    }


def validate_inputs(data: MarketData, session: dict, now) -> MarketData:
    day = date.fromisoformat(session["date"])
    daily = normalize(data.daily, daily=True)
    daily = daily[daily.index.date < day]
    if len(daily) < 100:
        raise DataQualityError("Fewer than 100 completed daily bars for a stable ATR reference")
    if daily.index[-1].date() != previous_session(day):
        raise DataQualityError("The previous completed daily session is missing")
    bars = regular_completed(data.bars3, now, 3)
    bars = bars[bars.index.date <= day]
    prior = bars[bars.index.date < day]
    today = bars[bars.index.date == day]
    if len(prior) < legacy_engine.WARM:
        raise DataQualityError("Fewer than 400 prior RTH three-minute warmup bars")
    if today.empty:
        raise DataQualityError("No completed bars for the display session")
    if today.index[0] != pd.Timestamp(session["open"]):
        raise DataQualityError("The opening three-minute bar is missing; session replay is incomplete")
    selected = pd.concat([prior.iloc[-legacy_engine.WARM:], today])
    expected = expected_bars(selected.index[0].date(), day)
    expected = expected[(expected >= selected.index[0]) & (expected <= selected.index[-1])]
    if not selected.index.equals(expected):
        raise DataQualityError("Missing or misaligned RTH bars in the 400-bar warmup or display session")
    one = regular_completed(data.bars1, now, 1) if data.bars1 is not None and not data.bars1.empty else None
    return MarketData(daily, selected, one, data.source, list(data.warnings))


def _unknown_probability(setup, cohort, target_index, reason):
    return {"event": f"T{target_index} before original stop by session close", "evidence": "UNAVAILABLE",
            "display_probability": None, "raw_rate": None, "hits": 0, "n": 0, "sessions": 0,
            "episodes": None, "interval": None, "interval_method": None, "estimate": None,
            "estimate_label": None, "target_index": target_index, "rr_bucket": None,
            "cohort_label": f"{setup} / {cohort}", "reason": reason,
            "training_end": None, "ambiguous": 0, "timeouts": 0, "method_notes": []}


def _model():
    from .probability import EvidenceModel
    return EvidenceModel(ROOT / "stats" / "signal_stats_v2.json")


def _event_id(event, day):
    bits = [sig2.VERSION, "SPY", day, event["setup"], event.get("cohort", "all"),
            str(event["side"]), event["decision_time"].isoformat()]
    return hashlib.sha256("|".join(bits).encode()).hexdigest()[:20]


def _signal(event, now, session, model, compatible):
    raw_status = event["status"]
    outcomes = event.get("outcomes", [])
    complete = pd.Timestamp(now) >= pd.Timestamp(session["close"])
    if raw_status == "pending_entry":
        status = "EXPIRED" if complete else "PENDING_ENTRY"
    elif raw_status == "cancelled_gap":
        status = "CANCELLED"
    else:
        status = "TRACKING" if "UNKNOWN" in outcomes else "CLOSED"
    note = event.get("why", event["setup"])
    if raw_status == "cancelled_gap":
        note += "; " + event.get("cancel_reason", "modeled next-open entry cancelled")
    else:
        note += "; scheduled replay, not a currently available entry"
    if event.get("tiny_risk"):
        note += "; risk below 0.05 daily ATR: R multiples can be unstable"
    targets = []
    for index, (label, price) in enumerate(event.get("targets", [])):
        rr = event.get("target_R", [])[index] if index < len(event.get("target_R", [])) else None
        if model is None or rr is None:
            probability = _unknown_probability(event["setup"], event.get("cohort", "all"), index + 1,
                                               "Entry geometry is not yet available." if rr is None else "Evidence file unavailable.")
        else:
            probability = model.for_target(event["setup"], event.get("cohort", "all"), index + 1, rr,
                                           decision_at=event["decision_time"].isoformat(), source_compatible=compatible)
            if session.get("early_close"):
                probability["display_probability"] = None
                probability["reason"] = "Early-close horizon differs from the 16:00 development sample. " + probability.get("reason", "")
        targets.append({"label": label, "price": price, "rr": rr,
                        "outcome": outcomes[index] if index < len(outcomes) else "UNKNOWN",
                        "ambiguous": event.get("amb", [False] * len(event["targets"]))[index],
                        "probability": probability})
    managed = event.get("managed_exit")
    return {
        "id": _event_id(event, session["date"]), "setup": event["setup"], "cohort": event.get("cohort", "all"),
        "side": "LONG" if event["side"] == 1 else "SHORT", "kind": "managed" if event.get("managed") else "context",
        "decision_at": event["decision_time"].isoformat(), "observed_at": now.isoformat(),
        "bar_at": event["bar_open"].isoformat(), "entry_at": event.get("entry_time").isoformat() if event.get("entry_time") is not None else None,
        "entry": event.get("entry"), "stop": event["stop"], "risk": event.get("risk"), "risk_atr": event.get("risk_atr"),
        "status": status, "eligibility": "HISTORICAL_REPLAY", "note": note, "targets": targets,
        "exit": {"reason": "Managed policy: " + managed["why"], "price": managed["exit"], "at": None} if managed else None,
        "event_type": event.get("event_type"), "signal_close": event["signal_close"],
        "modeled_fixed_t1_r": event.get("R_fixedT1"), "modeled_managed_r": event.get("R_managed"),
        "managed_outcome": event.get("managed_exit"),
        "eligible_for_forward_entry_evaluation": False,
    }


def build_snapshot(data: MarketData, now, model=None) -> dict:
    now = aware_now(now)
    session = context(now)
    data = validate_inputs(data, session, now)
    day = date.fromisoformat(session["date"])
    pc, atr, levels = legacy_engine.levels_for(data.daily, day)
    if not math.isfinite(atr) or atr <= 0:
        raise DataQualityError("Daily ATR is not positive and finite")
    events, strategy, today, indicators = sig2.replay(data.bars3, levels, atr, day, upto=pd.Timestamp(now))
    asof = today.index[-1] + pd.Timedelta(minutes=3)
    age = max(0, int((pd.Timestamp(now) - asof).total_seconds()))
    closed = pd.Timestamp(now) >= pd.Timestamp(session["close"])
    complete = closed and asof == pd.Timestamp(session["close"])
    healthy = complete if closed else age <= 900
    state = ("CLOSED" if complete else "CURRENT") if healthy else "STALE"
    warnings = list(data.warnings)
    if session.get("early_close"):
        warnings.append("Early close: outcome horizon is the exchange close; the development sample used 16:00 ET.")
    if closed and not complete:
        warnings.append("The closing bar is missing; unresolved outcomes remain UNKNOWN rather than TIMEOUT.")
    if model is None:
        try:
            model = _model()
        except (ImportError, FileNotFoundError, ValueError, KeyError) as exc:
            warnings.append(f"Evidence could not be loaded ({type(exc).__name__}); probabilities withheld.")
    signals = []
    compatible = bool(data.source.get("baseline_compatible")) and not session.get("early_close", False)
    for event in events:
        if event["kind"] == "ENTRY":
            scored = sig2.evaluate(event, today, indicators, complete=complete, m1=data.bars1)
            signals.append(_signal(scored, now, session, model, compatible))
    last = float(today.Close.iloc[-1])
    end = indicators[today.index[-1]]
    prior_po = indicators[today.index[-2]]["po"] if len(today) > 1 else None
    typical = (today.High + today.Low + today.Close) / 3
    volumes = today.Volume.cumsum()
    vwap = (typical * today.Volume).cumsum() / volumes.replace(0, float("nan"))
    alignment = "BULLISH" if end["e8"] > end["e21"] > end["e34"] else ("BEARISH" if end["e8"] < end["e21"] < end["e34"] else "MIXED")
    conviction = "BULLISH" if end["e13"] > end["e48"] else ("BEARISH" if end["e13"] < end["e48"] else "MIXED")
    ribbon_vals = [end[f"e{x}"] for x in (8, 13, 21, 34, 48)]
    position = "ABOVE" if last > max(ribbon_vals) else ("BELOW" if last < min(ribbon_vals) else "INSIDE")
    conflicts = []
    if alignment != "MIXED" and alignment != conviction:
        conflicts.append("8/21/34 alignment and RTH 13/48 conviction disagree.")
    if end["po"] is not None and ((alignment == "BEARISH" and end["po"] > 0) or (alignment == "BULLISH" and end["po"] < 0)):
        conflicts.append("Phase sign opposes ribbon alignment.")
    if not compatible:
        conflicts.append("Current feed or horizon parity with the development probability sample is unverified.")
    tracking = sum(s["status"] == "TRACKING" for s in signals)
    plan_state = "DATA_HOLD" if not healthy else ("TRACKING" if tracking else "WAIT")
    summary = "Snapshot is stale; wait for a successful refresh." if not healthy else (
        f"Tracking {tracking} historical fixed-barrier episode(s). No current entry is asserted." if tracking else
        "No unresolved historical episode. Watch a new confirmed setup; level proximity alone is not a trigger.")
    if complete:
        summary = "Session closed. Showing completed-session replay and resolved or timed-out barrier observations."
    bars = []
    for timestamp, row in today.iterrows():
        ind = indicators[timestamp]
        bars.append({"time": timestamp.isoformat(), **{col.lower(): float(row[col]) for col in COLUMNS},
                     **{f"ema{x}": ind[f"e{x}"] for x in (8, 21, 34, 48)}, "vwap": vwap.loc[timestamp], "phase": ind["po"]})
    output = {
        "schema_version": 1, "generated_at": now.isoformat(),
        "snapshot_id": hashlib.sha256(f"{now.isoformat()}|{asof.isoformat()}|{data.source.get('provider')}".encode()).hexdigest()[:16],
        "strategy": copy.deepcopy(STRATEGY), "session": session,
        "health": {"state": state, "reason": "Completed exchange session" if complete else (
            "Confirmed bars; periodic snapshot, not a live quote" if healthy else "Latest confirmed price is more than 15 minutes old"),
            "price_asof": asof.isoformat(), "age_seconds": age, "ttl_seconds": 900, "history_complete": True,
            "warnings": warnings, "source": data.source},
        "market": {"symbol": "SPY", "last": last, "prev_close": pc, "atr14": atr, "change": last - pc,
                   "change_atr": (last - pc) / atr, "vwap": vwap.iloc[-1], "day_high": float(today.High.max()), "day_low": float(today.Low.min())},
        "levels": [{"label": name, "multiple": legacy_engine.TARGET_LEVELS[name], "price": price, "distance": price - last}
                   for name, price in sorted(levels.items(), key=lambda item: item[1], reverse=True)],
        "ribbon": {**{f"ema{x}": end[f"e{x}"] for x in (8, 13, 21, 34, 48)}, "alignment": alignment,
                   "conviction": conviction, "price_position": position, "phase": end["po"],
                   "phase_slope": end["po"] - prior_po if prior_po is not None else None,
                   "squeeze": bool(strategy._squeeze())},
        "bars": bars, "plan": {"state": plan_state, "summary": summary, "conflicts": conflicts,
            "next_conditions": [{"label": label, "price": levels[key], "note": "Reference level only; requires a fresh qualified setup in its rule window."}
                                for label, key in (("Long trigger", "+23.6"), ("Short trigger", "-23.6"), ("Golden Gate up", "+38.2"), ("Golden Gate down", "-38.2"))]},
        "signals": list(reversed(signals)), "footnotes": FOOTNOTES.copy(),
        "evidence_id": getattr(model, "stats_id", None),
    }
    return clean(output)


def _digest(value):
    return hashlib.sha256(json.dumps(clean(value), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _append(path: Path, record: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(clean(record), separators=(",", ":"), allow_nan=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _geometry(signal):
    geometry = {k: signal.get(k) for k in ("entry", "stop", "entry_at", "risk")}
    geometry["targets"] = [{k: target.get(k) for k in ("label", "price", "rr")} for target in signal["targets"]]
    return geometry


def _recover_observations(path: Path, index: dict, day: str):
    """The append-only journal is authoritative if a crash interrupted index save."""
    if not path.exists():
        return
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            if record.get("kind") != "FIRST_OBSERVATION":
                continue
            event_id = record["id"]
            original = record["signal"]
            existing = index["events"].setdefault(event_id, {
                "first_observed_at": record["observed_at"], "geometry_hash": _digest(_geometry(original)),
                "entry_known": original.get("entry") is not None, "outcome_hash": None,
                "last_seen_price_asof": record.get("price_asof"), "present": True,
            })
            existing["session_date"] = day
            # Never replace the earliest recorded observation with the retry timestamp.
            if aware_now(record["observed_at"]) < aware_now(existing["first_observed_at"]):
                existing["first_observed_at"] = record["observed_at"]


def record_journal(snapshot: dict, directory: Path):
    """Append immutable observations, then distinct outcome updates and revision flags."""
    directory.mkdir(parents=True, exist_ok=True)
    index_path = directory / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"schema_version": 1, "events": {}}
    if not isinstance(index.get("events"), dict):
        raise DataQualityError("Persistent observation index is invalid")
    day = snapshot["session"]["date"]
    observations_path = directory / day / "observations.jsonl"
    _recover_observations(observations_path, index, day)
    price_asof = snapshot["health"]["price_asof"]
    verified = snapshot["health"]["state"] in {"CURRENT", "CLOSED"}
    current_ids = {signal["id"] for signal in snapshot["signals"]}
    for signal in snapshot["signals"]:
        event_id = signal["id"]
        existing = index["events"].get(event_id)
        geometry = _geometry(signal)
        result = {"status": signal["status"], "outcomes": [t["outcome"] for t in signal["targets"]],
                  "ambiguous": [t.get("ambiguous", False) for t in signal["targets"]],
                  "fixed_t1_r": signal.get("modeled_fixed_t1_r"), "managed_r": signal.get("modeled_managed_r")}
        geometry_hash, outcome_hash = _digest(geometry), _digest(result)
        if existing is None:
            record = {"schema_version": 1, "kind": "FIRST_OBSERVATION", "id": event_id,
                      "observed_at": snapshot["generated_at"], "price_asof": snapshot["health"]["price_asof"],
                      "strategy_version": sig2.VERSION, "evidence_id": snapshot.get("evidence_id"),
                      "source": snapshot["health"]["source"], "signal": copy.deepcopy(signal),
                      "eligible_for_forward_entry_evaluation": False,
                      "eligibility_reason": "Periodic replay was first observed after the modeled decision; not a timely entry forecast."}
            _append(observations_path, record)
            existing = {"first_observed_at": snapshot["generated_at"], "geometry_hash": geometry_hash,
                        "entry_known": signal["entry"] is not None, "outcome_hash": None,
                        "session_date": day, "present": True, "last_seen_price_asof": price_asof}
            index["events"][event_id] = existing
        signal["observed_at"] = existing["first_observed_at"]
        prior_asof = existing.get("last_seen_price_asof")
        at_least_as_recent = prior_asof is None or aware_now(price_asof) >= aware_now(prior_asof)
        if verified and at_least_as_recent:
            if existing.get("present") is False:
                _append(directory / day / "revisions.jsonl", {
                    "schema_version": 1, "kind": "REPLAY_EVENT_RESTORED", "id": event_id,
                    "observed_at": snapshot["generated_at"], "price_asof": price_asof,
                    "reason": "A previously withdrawn event is present in the latest complete replay."})
            existing["present"] = True
            existing["last_seen_price_asof"] = price_asof
        if existing["geometry_hash"] != geometry_hash:
            was_pending = not existing.get("entry_known") and signal["entry"] is not None
            _append(directory / day / "revisions.jsonl", {
                "schema_version": 1, "kind": "ENTRY_GEOMETRY_AVAILABLE" if was_pending else "PROVIDER_REPLAY_REVISION",
                "id": event_id, "observed_at": snapshot["generated_at"], "previous_geometry_hash": existing["geometry_hash"],
                "geometry": geometry, "probabilities": [t["probability"] for t in signal["targets"]],
                "eligible_for_forward_entry_evaluation": False})
            existing["geometry_hash"] = geometry_hash
            existing["entry_known"] = signal["entry"] is not None
            if not was_pending:
                signal["note"] += "; provider replay revised previously observed geometry (original retained in journal)"
        if existing["outcome_hash"] != outcome_hash:
            _append(directory / day / "outcomes.jsonl", {
                "schema_version": 1, "kind": "OUTCOME_OBSERVATION", "id": event_id,
                "observed_at": snapshot["generated_at"], "price_asof": snapshot["health"]["price_asof"],
                "outcome": result, "outcome_hash": outcome_hash})
            existing["outcome_hash"] = outcome_hash
    if verified:
        for event_id, existing in index["events"].items():
            if existing.get("session_date") != day or event_id in current_ids or existing.get("present") is False:
                continue
            last_seen = existing.get("last_seen_price_asof")
            if last_seen is not None and aware_now(price_asof) < aware_now(last_seen):
                continue
            _append(directory / day / "revisions.jsonl", {
                "schema_version": 1, "kind": "REPLAY_EVENT_WITHDRAWN", "id": event_id,
                "observed_at": snapshot["generated_at"], "price_asof": price_asof,
                "reason": "Event disappeared from a complete replay at least as recent as its last observation; original record retained."})
            existing["present"] = False
    _append(directory / day / "refreshes.jsonl", {
        "schema_version": 1, "generated_at": snapshot["generated_at"], "snapshot_id": snapshot["snapshot_id"],
        "price_asof": snapshot["health"]["price_asof"], "health": snapshot["health"]["state"],
        "source": snapshot["health"]["source"], "signals": len(snapshot["signals"]),
        "evidence_id": snapshot.get("evidence_id")})
    atomic_json(index_path, index)


def failure_snapshot(previous: dict | None, now, error: Exception) -> dict:
    output = copy.deepcopy(previous) if previous else initial_snapshot(now)
    clock = aware_now(now)
    output["generated_at"] = clock.isoformat()
    output["snapshot_id"] = None
    # Preserve the old session identity and price_asof: a failed fetch is not new market data.
    output.setdefault("health", {})["state"] = "STALE" if output.get("market", {}).get("last") is not None else "UNAVAILABLE"
    output["health"]["reason"] = f"Refresh failed ({type(error).__name__}); retained data is not current."
    if isinstance(error, DataQualityError):
        output["health"]["reason"] += " " + str(error)
    output["health"]["history_complete"] = False
    output["health"]["last_attempt_at"] = clock.isoformat()
    asof = output["health"].get("price_asof")
    output["health"]["age_seconds"] = max(0, int((clock - aware_now(asof)).total_seconds())) if asof else None
    output["plan"] = {"state": "DATA_HOLD", "summary": "Refresh failed. Inspect data health before using retained historical context.",
                      "next_conditions": [], "conflicts": []}
    for signal in output.get("signals", []):
        signal["eligibility"] = "DATA_HOLD"
    return clean(output)


def refresh(output: Path, state_dir: Path, now=None, provider="auto", fixture: Path | None = None) -> bool:
    clock = aware_now(now)
    request_started_at = clock.isoformat()
    previous = None
    if output.exists():
        try:
            previous = json.loads(output.read_text())
        except (ValueError, OSError):
            pass
    try:
        if fixture:
            payload = json.loads(fixture.read_text())
            def frame(rows):
                value = pd.DataFrame(rows)
                value.index = pd.to_datetime(value.pop("time"), utc=True).dt.tz_convert("America/New_York")
                return value.rename(columns={key: key.title() for key in value.columns})
            data = MarketData(frame(payload["daily"]), frame(payload["bars3"]), frame(payload["bars1"]) if payload.get("bars1") else None,
                              payload.get("source", {"provider": "FIXTURE", "symbol": "SPY", "baseline_compatible": False}),
                              ["OFFLINE FIXTURE: not live data."])
        else:
            data = fetch_market_data(clock, provider)
        if now is None:
            clock = aware_now()
        try:
            snapshot = build_snapshot(data, clock)
        except DataQualityError as exc:
            if provider != "auto" or fixture or data.source.get("provider") != "TradingView":
                raise
            data = fetch_market_data(clock, "yfinance")
            if now is None:
                clock = aware_now()
            data.warnings.append(f"TradingView data quality failed validation: {exc}")
            snapshot = build_snapshot(data, clock)
        snapshot["health"]["request_started_at"] = request_started_at
        record_journal(snapshot, state_dir)
        atomic_json(output, snapshot)
        return snapshot["health"]["state"] not in {"STALE", "UNAVAILABLE"}
    except Exception as exc:
        if now is None:
            clock = aware_now()
        failed = failure_snapshot(previous, clock, exc)
        failed["health"]["request_started_at"] = request_started_at
        atomic_json(output, failed)
        print(f"Dashboard refresh failed: {type(exc).__name__}", file=sys.stderr)
        return False
