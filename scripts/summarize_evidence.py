#!/usr/bin/env python3
"""Write compact, deterministic development-evidence JSON without training."""
from pathlib import Path
import argparse
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from saty_dashboard.probability import EvidenceModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stats", type=Path, default=ROOT / "stats/signal_stats_v2.json")
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/evidence.json")
    args = parser.parse_args()
    evidence = EvidenceModel(args.stats).summary()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(evidence, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, args.output)
    print(f"Development evidence: {len(evidence['cohorts'])} cohorts; {evidence['sessions']} sessions; no new training")


if __name__ == "__main__":
    main()
