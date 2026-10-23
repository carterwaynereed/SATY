#!/usr/bin/env python3
"""Rebuild per-ticker, feed-matched SATY development evidence; no rule fitting.

Network mode captures public TradingView bars to stats/tv/<symbol>/history.json.gz.
--frozen replays those same captured inputs without a network connection.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "engine"))
import tvdata
from saty_dashboard.calendar import aware_now
from saty_dashboard.tv_evidence import SYMBOLS, build_evidence, canonical_bytes, frame_from_values, source_identity, parity_reference


def save_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    raw = canonical_bytes(payload) + b"\n"
    temporary.write_bytes(gzip.compress(raw, mtime=0) if path.suffix == ".gz" else raw)
    temporary.replace(path)


async def capture(ticker, count):
    attempts = []
    for symbol in SYMBOLS[ticker]:
        try:
            async def pull(interval, n):
                values = await asyncio.wait_for(tvdata._get(symbol, interval, n, "regular", 15), 45)
                return values, dict(tvdata.META.get(symbol, {}))
            daily, daily_meta = await pull("D", 400)
            bars, metadata = await pull("3", count)
            if source_identity(symbol, daily_meta) != source_identity(symbol, metadata):
                raise ValueError("Daily and intraday TradingView source identities differ")
            attempts.append({"symbol": symbol, "result": "OK", "source_id": metadata.get("source_id"),
                             "reported_delay": metadata.get("delay")})
            return {"schema_version": 1, "symbol": ticker, "tv_symbol": symbol,
                    "captured_at": datetime.now(timezone.utc).isoformat(), "metadata": metadata,
                    "daily_metadata": daily_meta, "requested_3m_bars": count, "received_3m_bars": len(bars),
                    "attempts": attempts, "daily": daily, "bars3": bars}
        except Exception as exc:
            attempts.append({"symbol": symbol, "result": "ERROR", "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
    raise RuntimeError(json.dumps(attempts))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", nargs="+", choices=list(SYMBOLS), default=list(SYMBOLS))
    parser.add_argument("--count", type=int, default=20000)
    parser.add_argument("--frozen", action="store_true")
    parser.add_argument("--now", help="Aware build timestamp; frozen mode defaults to each recorded build time")
    parser.add_argument("--stats-dir", type=Path, default=ROOT / "stats/tv")
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/tv-evidence.json")
    parser.add_argument("--parity-output", type=Path, default=ROOT / "tests/fixtures/tv-replay-parity.json.gz")
    args = parser.parse_args()
    output = {"schema_version": 2, "evidence_state": "DEVELOPMENT", "by_symbol": {}}
    if args.output.exists():
        output["by_symbol"] = json.loads(args.output.read_text()).get("by_symbol", {})
    parity = {"strategy_version": "saty-sig-2.0", "by_symbol": {}}
    if args.parity_output.exists():
        parity = json.loads(gzip.decompress(args.parity_output.read_bytes()) if args.parity_output.suffix == ".gz" else args.parity_output.read_bytes())
    failed = []
    for ticker in args.symbols:
        try:
            folder = args.stats_dir / ticker
            history_path = folder / "history.json.gz"
            if args.frozen:
                history = json.loads(gzip.decompress(history_path.read_bytes()))
                if args.now:
                    built = aware_now(args.now)
                elif (folder / "evidence.json").exists():
                    built = aware_now(json.loads((folder / "evidence.json").read_text())["built"])
                else:
                    built = aware_now(history["captured_at"])
            else:
                history = asyncio.run(capture(ticker, args.count))
                built = aware_now(args.now)
                folder.mkdir(parents=True, exist_ok=True)
                history_path.write_bytes(gzip.compress(canonical_bytes(history), mtime=0))
            daily, _ = frame_from_values(history["daily"], daily=True)
            bars, volume_available = frame_from_values(history["bars3"])
            evidence, audit = build_evidence(ticker, history["tv_symbol"], daily, bars, history["metadata"], built, volume_available)
            evidence["capture"] = {k: history[k] for k in ("captured_at", "requested_3m_bars", "received_3m_bars", "attempts")}
            evidence["capture"]["archive_sha256"] = "sha256:" + __import__("hashlib").sha256(history_path.read_bytes()).hexdigest()
            save_json(folder / "evidence.json", evidence)
            save_json(folder / "ledger.json.gz", audit)
            output["by_symbol"][ticker] = evidence
            parity["by_symbol"][ticker] = parity_reference(history, audit)
            print(json.dumps({"symbol": ticker, "tv_symbol": history["tv_symbol"], "source": evidence["source"]["source_id"],
                              "sessions": evidence["sessions"], "from": evidence["training_from"], "to": evidence["training_to"],
                              "episodes": len(audit["ledger"]), "cells": len(evidence["cells"]),
                              "headline_size_cells": sum(c["n"] >= 20 for c in evidence["cells"])}), flush=True)
        except Exception as exc:
            failed.append(ticker)
            print(json.dumps({"symbol": ticker, "error": f"{type(exc).__name__}: {exc}"}), flush=True)
            # Retain an existing snapshot with its own source/build identity; never copy another ticker.
    output["built"] = max((v["built"] for v in output["by_symbol"].values()), default=datetime.now(timezone.utc).isoformat())
    save_json(args.output, output)
    save_json(args.parity_output, parity)
    if failed:
        raise SystemExit("Failed: " + ", ".join(failed))


if __name__ == "__main__":
    main()
