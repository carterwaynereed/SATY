"""Descriptive evidence for the frozen supplied development sample.

This module deliberately does not call probs2.predict: that estimator pools
multiple target rows from the same signal. Here every cell names one target,
setup, cohort and reward/risk bucket. This is a display change, not a newly
validated forecasting model or a modification to the signal engine.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from hashlib import sha256
import json
import math
from pathlib import Path
from typing import Any, Mapping
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATS = ROOT / "stats" / "signal_stats_v2.json"
ET = ZoneInfo("America/New_York")
MIN_DISPLAY_N = 20
BUCKETS = ("<0.5R", "0.5-1R", "1-2R", "2-4R", ">4R")


def rr_bucket(rr: float) -> str:
    """Match the supplied engine's boundaries exactly."""
    if rr < .5:
        return BUCKETS[0]
    if rr < 1:
        return BUCKETS[1]
    if rr < 2:
        return BUCKETS[2]
    if rr < 4:
        return BUCKETS[3]
    return BUCKETS[4]


def wilson(hits: int, n: int) -> list[float] | None:
    """95% Wilson interval; descriptive, not adjusted for session dependence."""
    if not isinstance(hits, int) or not isinstance(n, int) or not 0 <= hits <= n:
        raise ValueError("Require integer counts 0 <= hits <= n")
    if n == 0:
        return None
    z = 1.959963984540054
    p = hits / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    width = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return [max(0., center - width), min(1., center + width)]


def _aware_time(value: str | datetime | None) -> datetime | None:
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        return None
    return parsed if parsed.tzinfo is not None else None


class EvidenceModel:
    """Read-only evidence table with an auditable content hash and safe gates."""

    def __init__(self, stats_path: str | Path | Mapping[str, Any] = DEFAULT_STATS):
        if isinstance(stats_path, Mapping):
            raw = json.dumps(dict(stats_path), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        else:
            raw = Path(stats_path).read_bytes()
        self.stats = json.loads(raw)
        self.stats_id = "sha256:" + sha256(raw).hexdigest()
        self.training_from, self.training_to = self.stats.get("days", [None, None])
        self.built = self.stats.get("built")
        self._cells: dict[tuple, list[dict]] = defaultdict(list)
        self._cohorts: dict[tuple, list[dict]] = defaultdict(list)
        for row in self.stats.get("obs", []):
            if row.get("y") not in (0, 1) or row.get("j") not in (0, 1, 2):
                raise ValueError("Invalid supplied target observation")
            if row.get("b") not in BUCKETS:
                raise ValueError("Unknown reward/risk bucket")
            row_day = date.fromisoformat(row["day"])
            if self.training_from and row_day < date.fromisoformat(self.training_from):
                raise ValueError("Observation precedes declared training range")
            if self.training_to and row_day > date.fromisoformat(self.training_to):
                raise ValueError("Observation exceeds declared training cutoff")
            key = (row["setup"], row["cohort"], row["j"], row["b"])
            self._cells[key].append(row)
            self._cohorts[(row["setup"], row["cohort"])].append(row)

    def for_target(self, setup: str, cohort: str, target_index: int, rr: float | None,
                   decision_at: str | datetime | None = None,
                   source_compatible: bool = False) -> dict:
        """Exact cell evidence. Rates are fractions; target_index is one-based.

        display_probability is a historical raw frequency, never a validated
        probability for a future trade. It is hidden for thin cells, incompatible
        sources and any decision preceding the data cutoff or model availability.
        The raw descriptive counts remain available even when display is hidden.
        """
        if target_index not in (1, 2, 3):
            raise ValueError("target_index must be 1, 2 or 3")
        valid_rr = isinstance(rr, (float, int)) and not isinstance(rr, bool) and math.isfinite(rr) and rr > 0
        bucket = rr_bucket(rr) if valid_rr else None
        rows = self._cells.get((setup, cohort, target_index - 1, bucket), [])
        n = len(rows)
        hits = sum(row["y"] for row in rows)
        rate = hits / n if n else None
        reasons = []
        if not valid_rr:
            reasons.append("Risk or target distance unavailable; no matching probability cell")
        if n < MIN_DISPLAY_N:
            reasons.append(f"Thin exact cell: {n} target events; headline requires at least {MIN_DISPLAY_N}")
        if not source_compatible:
            reasons.append("Current data source/session horizon not verified comparable to development data")
        decision = _aware_time(decision_at)
        built = _aware_time(self.built)
        if decision is None:
            reasons.append("Decision timestamp unavailable; chronology not verified")
        else:
            if not self.training_to or self.training_to >= decision.astimezone(ET).date().isoformat():
                reasons.append("Training cutoff is not strictly before the decision session")
            if built is None or built > decision:
                reasons.append("Evidence snapshot was not available at this decision time")
        notes = [
            "Historical descriptive frequency, not a calibrated live forecast or a profitability estimate.",
            "One target index per cell; other targets from the same signal are never pooled into this denominator.",
            "Episode count is inferred from one row per entered signal/target in build_stats2.obs_of; source episode IDs were not supplied and independence is unverified.",
            "Both directions are pooled because the supplied observations omit side. Sessions count only rows in this target denominator, not cancelled-candidate sessions.",
            "Signals can overlap within a session. Wilson 95% assumes independent Bernoulli trials and may understate uncertainty here.",
            "Unresolved same-bar target/stop order uses stop-first; completed-session timeouts count as target not hit. Unknown outcomes are excluded by the supplied generator.",
            "Original-stop barrier event differs from the engine's managed-exit P&L policy; no fees, slippage or options payoff is modeled.",
            "Reward/risk bucket boundaries were selected after inspecting development data. No independent holdout claim.",
        ]
        return {
            "event": f"T{target_index} touched before ORIGINAL stop by session close (development horizon 16:00 ET)",
            "evidence": "DEVELOPMENT",
            "display_probability": rate if not reasons else None,
            "raw_rate": rate, "hits": hits, "n": n,
            "sessions": len({row["day"] for row in rows}),
            "episodes": n, "independent_episodes": None,
            "interval": wilson(hits, n),
            "interval_method": "Wilson 95% (descriptive; sessions correlated)",
            "estimate": None,
            "estimate_label": "No validated forecast; exact-cell raw descriptive rate only",
            "target_index": target_index, "rr_bucket": bucket,
            "cohort_label": f"{setup} / {cohort} / T{target_index} / {bucket or 'unavailable R'}",
            "reason": "; ".join(reasons) if reasons else "Development sample only; adequate count does not establish predictive value",
            "training_end": self.training_to, "available_at": self.built, "stats_id": self.stats_id,
            "ambiguous": sum(row.get("amb", 0) for row in rows),
            "timeouts": sum(row.get("to", 0) for row in rows),
            "target_first_sensitivity": sum(row.get("y_tf", row["y"]) for row in rows) / n if n else None,
            "method_notes": notes,
        }

    def summary(self) -> dict:
        cohorts = []
        supplied = self.stats.get("summary", {})
        for (setup, cohort), rows in sorted(self._cohorts.items()):
            t1 = [row for row in rows if row["j"] == 0]
            n = len(t1)
            h = sum(row["y"] for row in t1)
            info = supplied.get(f"{setup} | {cohort}", {})
            if info and (info.get("t1_h") != h or info.get("t1_n") != n):
                raise ValueError(f"Supplied summary and observations disagree for {setup} / {cohort}")
            cohorts.append({
                "setup": setup, "cohort": cohort, "episodes": n,
                "sessions": len({row["day"] for row in t1}),
                "candidate_sessions": info.get("sessions"),
                "independent_episodes": None,
                "t1": {"hits": h, "n": n, "rate": h / n if n else None, "interval": wilson(h, n)},
                "median_t1_r": info.get("med_T1_R"),
                "ambiguous": sum(row.get("amb", 0) for row in t1),
                "timeouts": sum(row.get("to", 0) for row in t1),
                "cancelled": info.get("cancelled"),
                "tiny_risk": info.get("tiny_risk"),
                "session_bootstrap_t1_interval": info.get("t1_boot"),
                "session_bootstrap_note": "Supplied retrospective session bootstrap; not independently reproduced because raw ledger and bars were not attached",
            })
        return {
            "schema_version": 1, "stats_id": self.stats_id,
            "strategy_version": self.stats.get("version"),
            "training_from": self.training_from, "training_to": self.training_to,
            "built": self.built, "evidence_state": "DEVELOPMENT",
            "sessions": self.stats.get("n_days", 0),
            "event_definition": self.stats.get("definition"),
            "method": "Raw historical frequency for exact setup + cohort + target index + reward/risk bucket; Wilson 95% descriptive interval. No smoothed forecast is published.",
            "source": self.stats.get("source"),
            "limitations": [
                "Only 34 development sessions; no independent forward or untouched holdout validation is supplied.",
                "Source event ledger and raw baseline bars were not attached. Counts are reconciled to the supplied statistics, not independently re-replayed.",
                "Episode IDs and direction are absent from target observations. Counts are entered signals inferred from the supplied generator; overlapping signals are not independent trials.",
                "Sessions displayed beside a target count include only entered/resolved observations; the supplied summary can include additional sessions with cancelled candidates.",
                "Wilson intervals ignore session clustering. Supplied cohort bootstrap intervals are retrospective diagnostics.",
                "RTH 13/48 EMA conviction differs from Saty's extended-session implementation; this version remains frozen.",
                "RR bucket boundaries and cohorts were examined after seeing the sample. Legacy chronological diagnostics are exploratory, not clean out-of-sample proof.",
                "Legacy pooled-target smoothed probabilities are omitted from setup cards; their historical calibration diagnostics do not validate the exact-target display method.",
                "Provider/session-horizon changes and evidence unavailable at decision time suppress the headline rate.",
                "No options-return probability, fill model, commissions or slippage adjustment is implied.",
            ],
            "cohorts": cohorts,
            "calibration": {
                "state": "EXPLORATORY_LEGACY_MODEL",
                "note": "Supplied probs2 pooled-target model diagnostics, not validation of the dashboard's exact-target descriptive cells. Target rows can share a signal and session.",
                "expanding": self.stats.get("expanding", {}),
                "reliability": self.stats.get("reliability", {}),
                "folds": self.stats.get("folds", []),
            },
            "forward": {"state": "COLLECTING", "validated_sessions": 0, "validated_episodes": 0,
                        "note": "First-observed logs must be checked for data availability and entry timing before inclusion in a forward evaluation."},
        }


def attach_probability(setup: str, cohort: str, target_index: int, rr: float | None,
                       stats: EvidenceModel | Mapping | str | Path | None = None,
                       decision_at: str | datetime | None = None,
                       provider: str | Mapping | None = None,
                       source_compatible: bool | None = None) -> dict:
    """Convenience wrapper; provider name alone cannot prove feed comparability."""
    model = stats if isinstance(stats, EvidenceModel) else EvidenceModel(stats or DEFAULT_STATS)
    compatible = source_compatible is True
    if source_compatible is None and isinstance(provider, Mapping):
        compatible = provider.get("evidence_compatible") is True
    return model.for_target(setup, cohort, target_index, rr, decision_at, compatible)
