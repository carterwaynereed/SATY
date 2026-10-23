# TradingView evidence rebuild — 23 October 2026

The live desk uses the public, unauthenticated TradingView chart source returned for each symbol. The original supplied `stats/signal_stats_v2.json` and frozen Python engine are preserved. A separate development replay now records actual provider metadata and a source fingerprint for each ticker, so “TradingView” alone is no longer treated as proof of feed comparability.

## Captured and replayed sample

| Ticker | Requested TradingView symbol | Returned source | Complete eligible sessions | Entered episodes | Resolved target events | Exact cells with n ≥ 20 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| SPY | AMEX:SPY | BATS | 34 | 229 | 649 | 8 |
| SPX | TVC:SPX | TVC | 34 | 224 | 633 | 8 |
| AAPL | NASDAQ:AAPL | BATS | 34 | 259 | 755 | 8 |
| GOOGL | NASDAQ:GOOGL | BATS | 34 | 249 | 717 | 9 |

All four training ranges are **2026-09-04 through 2026-10-22**. Each request asked for 20,000 three-minute bars; the public endpoint returned approximately 5,060 bars, beginning 2026-08-31. The first four sessions provide warmup and the current session is excluded. The declared sample reflects the bars actually returned, not the requested count.

The capture times and complete original metadata are in `stats/tv/<TICKER>/evidence.json`. The actual compressed daily and intraday inputs are in `history.json.gz`; `ledger.json.gz` records stable, ticker-specific episode IDs, original targets/stops, modeled entries, ambiguity and outcomes. These reproducibility artifacts are outside the website's public asset directory. The page reads the compact, roughly 115 KB `site/data/tv-evidence.json` bundle.

The live feed probe also evaluated `SP:SPX`: it returned a reported 600-second delay and older bars. `TVC:SPX` returned current completed bars, so it is the primary SPX source. A fallback to a different index source must suppress the historical headline until that fallback's own fingerprint matches an evidence dataset. SPX volume is absent; zero-volume placeholders are explicitly marked unavailable and must never generate a VWAP vote.

## What is counted

The event is: **T_i is touched before the original frozen stop by 16:00 ET, after a decision on a confirmed 3m close and modeled entry at the next 3m open.** Each exact cell uses one ticker, setup, cohort, target index and reward/risk bucket. Other targets from the same episode do not inflate its denominator. Both directions are pooled within each cell; episodes can overlap in a session.

The replay runs unchanged `engine/sig2.py` and its default strategy. It uses daily references strictly before the session, at least 100 prior daily bars and 400 continuous prior regular-session 3m bars. A missing bar, missing prior daily session or early close excludes the affected training session. Today's session is never added to today's development evidence.

All observations use **3m stop-first** for unresolved within-bar stop/target order. This matches the lean live engine's available bars. The rebuild deliberately does not mix recent 1m resolution with older 3m-only observations. Target-first ambiguity sensitivity is retained separately. Gap cancellations and gap-aware barrier evaluation are preserved. No fills, fees, slippage, option returns or order execution are modeled.

The display keeps `hits`, `n`, session count, episode count and a **Wilson 95% descriptive interval**. `n < 20` suppresses a headline. A source mismatch, evidence built after the original decision, or a training cutoff reaching the decision session also suppresses the headline. The source fingerprint is SHA-256 of sorted compact JSON containing provider, requested/resolved symbol, source ID, RTH basis, 3m interval and split adjustment. The Python and JavaScript implementations share tested fingerprints.

**DEVELOPMENT** remains the evidence state. A higher count is not evidence of calibration, independence or forward profitability. Wilson intervals ignore within-session dependence. The prior RR buckets and rules were developed with historical data; this rebuild is not an untouched holdout test or automatic rule promotion.

## Reproduce or refresh

From the repository root, after installing `requirements.txt`:

```sh
python scripts/rebuild_tv_evidence.py --frozen
node --test tests/saty-parity.test.mjs
python -m unittest discover -s tests -p 'test_tv_evidence.py' -v
```

`--frozen` replays the stored inputs without network access and retains each recorded build timestamp. It regenerates the small Python reference fixture used by the JavaScript parity tests. To capture fresh public inputs and create a newly dated development snapshot, run:

```sh
python scripts/rebuild_tv_evidence.py
```

The rebuild always uses the requested ticker's own source; a failure retains an existing ticker snapshot with its original identity and exits with an error. It never copies another ticker's statistics. Review the regenerated data, source identity, excluded sessions and parity result before committing. Dataset updates are separate from candidate rule changes and do not promote a challenger.

## Engine parity verification

The JavaScript live port is compared against the unchanged Python implementation over **140 ticker-session cases**: 34 full development sessions plus the captured current session for each ticker. Tests check prior close, ATR, all five final ribbon EMAs, phase, squeeze state, exact entry count, setup/cohort/direction, decision time, stop, target levels, modeled next-open entries, gap cancellations, original-stop barrier outcomes and ambiguous outcomes. The references are generated from the Python engine and stored in `tests/fixtures/tv-replay-parity.json.gz`; the full raw bars are read from the compressed captures.
