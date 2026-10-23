#!/usr/bin/env python3
"""Fast exchange-calendar gate for scheduled Actions, including DST and half days."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from saty_dashboard.calendar import market_gate

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--now", help="Aware ISO timestamp for deterministic checks")
parser.add_argument("--github-output", type=Path)
args = parser.parse_args()
active, reason = market_gate(args.now)
text = f"active={'true' if active else 'false'}\nreason={reason}\n"
print(text, end="")
if args.github_output:
    with args.github_output.open("a") as handle:
        handle.write(text)
