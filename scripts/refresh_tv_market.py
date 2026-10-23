#!/usr/bin/env python3
"""Bounded, four-symbol public TradingView capture for the scheduled mirror.

The hosted Site reads TradingView itself every 15 seconds. A GitHub Actions
reference refreshed about every ten minutes is not presented as that live path.
"""
from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "engine"))
import tvdata
from saty_dashboard.calendar import aware_now
from saty_dashboard.providers import regular_completed
from saty_dashboard.tv_evidence import SYMBOLS, frame_from_values, source_identity


def json_bars(frame, volume_available=True):
    return [{"time": stamp.astimezone(timezone.utc).isoformat(), "open": float(row.Open),
             "high": float(row.High), "low": float(row.Low), "close": float(row.Close),
             "volume": float(row.Volume) if volume_available else None}
            for stamp, row in frame.iterrows()]


async def capture_ticker(ticker: str, pull=tvdata._get, clock=None):
    attempts = []

    async def collect():
        for symbol in SYMBOLS[ticker]:
            try:
                async def interval(tf, count):
                    values = await asyncio.wait_for(pull(symbol, tf, count, "regular", 10), timeout=14)
                    # META is keyed by requested symbol. Intervals for one symbol
                    # are sequential, so other ticker threads cannot clobber it.
                    return values, dict(tvdata.META.get(symbol, {}))
                daily_raw, daily_meta = await interval("D", 400)
                three_raw, meta = await interval("3", 1200)
                identity = source_identity(symbol, meta)
                if not identity["source_id"]:
                    raise ValueError("Provider omitted source identity")
                if source_identity(symbol, daily_meta) != identity:
                    raise ValueError("Daily and 3m source identities do not match")
                daily, daily_volume = frame_from_values(daily_raw, daily=True)
                three, three_volume = frame_from_values(three_raw)
                notes, one_raw, one_meta = [], None, None
                try:
                    one_raw, one_meta = await interval("1", 2000)
                    if source_identity(symbol, one_meta) != identity:
                        raise ValueError("1m source identity differs; 10m ribbon withheld")
                except Exception as exc:
                    one_raw = None
                    notes.append(f"10m ribbon unavailable: {type(exc).__name__}: {str(exc)[:160]}")
                now = aware_now(clock)
                bars = json_bars(regular_completed(three, now, 3), three_volume)
                if not bars:
                    raise ValueError("No confirmed regular-session 3m bars")
                one_bars = []
                if one_raw:
                    one, one_volume = frame_from_values(one_raw)
                    one_bars = json_bars(regular_completed(one, now, 1), one_volume)
                source = {"provider": "TradingView", "symbol": symbol, "source_id": identity["source_id"],
                          "pro_name": identity["pro_name"], "interval": "3m", "session_basis": "RTH", "adjustment": "splits",
                          "feed_fingerprint": identity["fingerprint"],
                          "identity": {k: v for k, v in identity.items() if k != "fingerprint"},
                          "feed_name": f"TradingView {symbol} · {identity['source_id']}",
                          "delay_seconds": meta.get("delay"), "reported_delay": meta.get("delay"),
                          "realtime": meta.get("is_realtime") if isinstance(meta.get("is_realtime"), bool) else None,
                          "data_status": meta.get("data_status"), "notes": notes}
                attempts.append({"symbol": symbol, "status": "OK", "source_id": identity["source_id"],
                                 "reported_delay_seconds": meta.get("delay")})
                return {"symbol": ticker, "source": source, "bars": bars, "daily": json_bars(daily, daily_volume),
                        "one_bars": one_bars, "attempts": attempts, "fetched_at": now.isoformat()}
            except Exception as exc:
                attempts.append({"symbol": symbol, "status": "ERROR", "error": f"{type(exc).__name__}: {str(exc)[:180]}"})
        return {"symbol": ticker, "error": "Neither configured TradingView source returned usable data" if len(SYMBOLS[ticker]) > 1 else "TradingView source unavailable", "attempts": attempts}

    try:
        return await asyncio.wait_for(collect(), timeout=40)
    except Exception as exc:
        attempts.append({"symbol": SYMBOLS[ticker][0], "status": "ERROR", "error": f"{type(exc).__name__}: overall 40s symbol deadline"})
        return {"symbol": ticker, "error": "TradingView refresh exceeded its bounded deadline", "attempts": attempts}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/market.json")
    parser.add_argument("--now", help="Aware clock override, for an explicitly dated replay")
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {symbol: pool.submit(lambda s=symbol: asyncio.run(capture_ticker(s, clock=args.now))) for symbol in SYMBOLS}
        feeds = {symbol: future.result() for symbol, future in futures.items()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="saty-tv-market-") as directory:
        path = Path(directory) / "feeds.json"
        path.write_text(json.dumps(feeds, separators=(",", ":"), allow_nan=False))
        command = ["node", str(ROOT / "scripts/build_market.mjs"), "--input", str(path), "--output", str(args.output.resolve())]
        if args.now:
            command += ["--now", args.now]
        subprocess.run(command, cwd=ROOT, check=True)
    if any(feed.get("error") for feed in feeds.values()):
        raise SystemExit("One or more tickers unavailable; explicit per-ticker DATA HOLD written to mirror")


if __name__ == "__main__":
    main()
