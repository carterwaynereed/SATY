#!/usr/bin/env python3
"""Publish a small, deterministic learning registry; never train or promote a rule."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTIVE = {"REGISTERED", "SHADOW", "REVIEW"}
STATES = ACTIVE | {"RESEARCH", "PROMOTED", "REJECTED", "RETIRED"}
REPOSITORY = "https://github.com/carterwaynereed/SATY"
PROMOTION_RULES = [
    "Run one frozen challenger against the unchanged baseline on the same eligible sessions, including zero-signal sessions.",
    "Register the rule difference, primary metric, minimum useful effect, costs, exclusions and fixed review date before collecting evaluation data.",
    "Collect at least 30 new market sessions and 100 nonduplicated eligible episodes; these are review floors, not proof of an edge.",
    "Meet the registered effect and guardrail criteria with session-cluster uncertainty, source parity and delay/cost stress checks.",
    "Require Carter's reviewed, versioned promotion PR, an effective date and a rollback commit. Never auto-promote or retune from a daily result.",
]


def read_log(path: Path) -> dict[str, dict]:
    """Resolve append-only records while rejecting ambiguous correction history."""
    records: dict[str, dict] = {}
    current: dict[str, dict] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
        except (ValueError, TypeError) as exc:
            raise ValueError(f"{path.name}:{number}: invalid JSON") from exc
        if not isinstance(record, dict):
            raise ValueError(f"{path.name}:{number}: expected an object")
        record_id, candidate_id = record.get("record_id"), record.get("candidate_id")
        if not record_id or not candidate_id or not record.get("recorded_at"):
            raise ValueError(f"{path.name}:{number}: record ID, candidate ID and recorded_at are required")
        if record_id in records:
            raise ValueError(f"{path.name}:{number}: duplicate record ID {record_id}")
        if record.get("status") not in STATES:
            raise ValueError(f"{path.name}:{number}: unknown status")
        prior = current.get(candidate_id)
        if record.get("supersedes_record_id") != (prior["record_id"] if prior else None):
            raise ValueError(f"{path.name}:{number}: update must supersede the prior record for this candidate")
        records[record_id] = record
        current[candidate_id] = record
    return current


def summarize(directory: Path) -> dict:
    candidates = read_log(directory / "candidates.jsonl")
    challengers = read_log(directory / "challengers.jsonl")
    active = []
    for candidate_id, record in challengers.items():
        if candidate_id not in candidates:
            raise ValueError(f"Challenger {candidate_id} is missing from the candidate registry")
        status = record["status"]
        if status == "RESEARCH":
            raise ValueError("Research ideas belong in candidates.jsonl, not the challenger log")
        if status in ACTIVE | {"PROMOTED"}:
            required = ("baseline_commit", "challenger_commit", "strategy_version", "evidence_hash",
                        "registered_at", "evaluation_start", "evaluation_end", "review_date",
                        "primary_metric", "minimum_effect", "decision_rule", "source_and_session_basis",
                        "episode_definition", "overlap_policy", "cost_and_delay_assumptions",
                        "multiplicity_and_stopping_plan")
            missing = [name for name in required if record.get(name) in (None, "")]
            if missing:
                raise ValueError(f"Challenger {candidate_id} has an incomplete frozen plan: {', '.join(missing)}")
        results = record.get("results") or {}
        for name in ("sessions", "eligible_episodes"):
            count = results.get(name, 0)
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise ValueError(f"Challenger {candidate_id}: {name} must be a nonnegative integer")
        if status == "PROMOTED":
            if results.get("sessions", 0) < 30 or results.get("eligible_episodes", 0) < 100:
                raise ValueError(f"Challenger {candidate_id} has not reached the initial review floor")
            for name in ("decision", "reviewed_by", "reviewed_at", "promotion_pr", "rollback_commit"):
                if not record.get(name):
                    raise ValueError(f"Challenger {candidate_id}: promotion requires {name}")
        if status in ACTIVE:
            active.append(record)
    if len(active) > 1:
        raise ValueError("Only one REGISTERED, SHADOW or REVIEW challenger may be active against the baseline")

    rows = []
    for candidate_id, record in candidates.items():
        source = record.get("source") or {}
        if source.get("public_safe") is not True:
            raise ValueError(f"Candidate {candidate_id}: this public registry requires a publishable source paraphrase")
        if not record.get("hypothesis") or not record.get("rule_delta") or not source.get("locator"):
            raise ValueError(f"Candidate {candidate_id}: source locator, hypothesis and rule_delta are required")
        challenger = challengers.get(candidate_id)
        if record["status"] in ACTIVE and not challenger:
            raise ValueError(f"Candidate {candidate_id}: active status has no frozen challenger plan")
        if record["status"] == "PROMOTED" and (not challenger or challenger["status"] != "PROMOTED"):
            raise ValueError(f"Candidate {candidate_id}: promotion has no reviewed challenger record")
        rows.append({"id": candidate_id, "status": challenger["status"] if challenger else record["status"],
                     "hypothesis": record["hypothesis"], "rule_delta": record["rule_delta"],
                     "source": {name: source.get(name) for name in ("type", "locator", "captured_at")}})
    selected = None
    if active:
        record = active[0]
        selected = {name: record.get(name) for name in
                    ("candidate_id", "status", "baseline_commit", "challenger_commit", "registered_at",
                     "review_date", "primary_metric", "minimum_effect")}
        selected["results"] = {name: (record.get("results") or {}).get(name, 0)
                               for name in ("sessions", "eligible_episodes")}
    digest = hashlib.sha256((directory / "candidates.jsonl").read_bytes() + b"\n" +
                            (directory / "challengers.jsonl").read_bytes()).hexdigest()
    return {
        "schema_version": 1, "registry_id": digest,
        "baseline": {"version": "saty-sig-2.0", "session_basis": "RTH"},
        "state": selected["status"] if selected else "RESEARCH",
        "candidate_count": len(rows), "active_challenger": selected, "candidates": rows,
        "promotion": {"minimum_sessions": 30, "minimum_episodes": 100, "automatic": False,
                      "rules": PROMOTION_RULES},
        "links": {"guide": f"{REPOSITORY}/blob/main/learning/README.md",
                  "candidates": f"{REPOSITORY}/blob/main/learning/candidates.jsonl",
                  "challengers": f"{REPOSITORY}/blob/main/learning/challengers.jsonl"},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--learning", type=Path, default=ROOT / "learning")
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/learning.json")
    args = parser.parse_args()
    result = summarize(args.learning)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n",
                         encoding="utf-8")
    os.replace(temporary, args.output)
    print(f"Learning registry: {result['candidate_count']} candidates; {result['state']}; automatic promotion disabled")


if __name__ == "__main__":
    main()
