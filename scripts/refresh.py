#!/usr/bin/env python3
"""Write one compact snapshot, with a visible HOLD and nonzero status on failure."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from saty_dashboard.runner import atomic_json, initial_snapshot, refresh

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=Path("site/data/latest.json"))
parser.add_argument("--state-dir", type=Path, default=Path("state"))
parser.add_argument("--now", help="Aware ISO timestamp for deterministic replay/tests")
parser.add_argument("--provider", choices=["auto", "tradingview", "yfinance"], default="auto")
parser.add_argument("--fixture", type=Path, help="Offline OHLCV fixture, explicitly labeled in output")
parser.add_argument("--init", action="store_true", help="Write an honest unavailable placeholder without a feed request")
args = parser.parse_args()
if args.init:
    atomic_json(args.output, initial_snapshot(args.now))
    raise SystemExit(0)
raise SystemExit(0 if refresh(args.output, args.state_dir, args.now, args.provider, args.fixture) else 1)
