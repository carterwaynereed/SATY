# Saty signals: SPY, signal-only (no tastytrade)
This folder has **no broker, no login, no orders, no tastytrade API, and no SMS.** It reads charts and reports Saty setups with historical probabilities.
The old auto-trader is still in /workspace/scalper, untouched and not running.

## Data
- **Primary: TradingView chart websocket** (`tvdata.py`). It needs no login (`unauthorized_user_token`) and uses symbol `AMEX:SPY` with 1m/3m/daily bars.
  The feed is real-time, and the latest 1m bar is the current minute. Without a TradingView login the source is the **Cboe One** feed, so volume is Cboe-only, but prices and prev close match the consolidated tape (prev close 763.96 and ATR14 7.37 match yfinance on 2026-10-23).
- **Fallback: yfinance** (SPY 1m resampled to 3m, plus daily). It's used automatically if TradingView errors. Whichever source was used is recorded in every signal (`data_source`) and in latest.md.

## Indicators (3m bars, regular session)
- **Saty ATR Levels**: prev daily close ± {23.6, 38.2, 50, 61.8, 78.6, 100}% of Wilder ATR14 (daily). ±123.6/138.2/161.8/200 are used only as targets beyond ±100%.
- **Pivot Ribbon**: EMAs 8/21/34 for stacking, plus 13 vs 48 for conviction. 13 and 48 are displayed too.
- **Phase Oscillator**: EMA3 of (close − EMA21) / (3·ATR14) × 100. Zones are ±23.6, ±61.8, and ±100.
- **Squeeze**: TTM (BB(20,2) inside KC(20,1.5 ATR)) and ribbon width ≤ 10th percentile.

## Setups (rules copied unchanged from scalper `strategy_v3`/`strategy_po` in `lib/`)
- **trigger break**: close through ±23.6 with the ribbon stacked and 13/48 agreeing. Stop is the 23.6 level.
- **GG pullback to ribbon**: after the Golden Gate opens, a pullback touches the 8 EMA and holds the 21. Stop is the 34 EMA.
- **ribbon re-entry**: same pullback, without the GG condition.
- **squeeze breakout**: close outside a squeeze range of 3 or more bars, in the trend direction. Stop is the other side of the range.
  Windows: trigger/GG/re-entry run 9:35–11:30 and 15:00–15:30. Squeeze runs 9:35–15:30. Only one strategy setup is open at a time, and its EXIT/TRIM updates are logged.
- Context signals (run 9:35–15:30, independent of the above):
  - **golden gate open**: first close beyond ±38.2 while ±61.8 hasn't been reached yet. Targets are 61.8 and 100; stop is 23.6.
  - **ribbon flip**: 8/21/34 newly stack. Stop is the 5-bar swing.
- Targets are the next ATR levels beyond entry (+0.05 ATR buffer), with up to 3 per setup.

## Probabilities
`build_stats.py` replays the exact same engine over every past session in TradingView 3m history (currently 34 sessions, 2026-09-04..2026-10-22).
For each signal it records whether price **touched T1/T2/T3 before touching the stop** in the same session. The stop is checked first inside a bar, which is conservative. No slippage is modeled.
- Each % is smoothed: (hits + 10·pooled rate) / (n + 10). Raw hits/n is always shown alongside it.
- If n < 5, **no %** is given ("sample too thin"). If n < 20, it's flagged "thin".
- A secondary figure, `scalper_trade_winrate`, is the old scalper backtest P&L win rate (n = 8–10 per setup).
- The loop rebuilds stats automatically after 16:00 each weekday.

## Run
    ./run.sh          # background loop (nohup). PID in loop.pid. Idle outside 09:30-16:00 ET weekdays.
    ./stop.sh
    /workspace/v/bin/python snapshot.py      # one-shot: levels, ribbon, phase, squeeze, active setup, today's signals
    /workspace/v/bin/python build_stats.py   # rebuild probability stats
Outputs:
- `signals.jsonl`: one JSON object per new signal. Fields: time_et, direction, setup, entry, stop, targets, prob_target_before_stop[], option_hint (informational), and backfilled.
- `latest.md`: today's levels and signals, rewritten every ~20 s.
- `logs/YYYY-MM-DD.log` and `logs/nohup.out`.

Robustness: each poll re-fetches bars and deterministically replays today, so gaps and backfills self-heal. Errors are logged and retried with backoff, and the loop never halts.
Option hints (0DTE first-OTM strike) are **informational only**. There are no quotes or pricing.

## v2 (saty-sig-2.0, 2026-10-23) — audit fixes (see audit_1.md)
- `sig2.py` causal engine: decision at 3m close, modeled entry = next 3m open (cancel if beyond stop/T1); event_type + cohort
  (trigger: fresh vs late/gap; GG open: fresh / late/gap / re-attempt, requires 61.8 untouched; GG pullback: pre/post GG destination).
- Fixed-barrier outcomes (TARGET_FIRST/STOP_FIRST/TIMEOUT/UNKNOWN, gap-aware, 1m same-bar resolution, stop-first + target-first) kept
  separate from the v3 managed exit policy (R_managed). OHLC warm-up (fixes PO/Keltner ATR warm-up bug).
- `probs2.py`: probability conditioned on reward-to-risk bucket, shrinkage cell→setup×bucket→bucket pool, Wilson CI shown.
- `build_stats2.py [--frozen]` → stats/signal_stats_v2.json, stats/ledger_v2.csv (walk-forward folds, Brier, reliability, bootstrap).
- `audit_tests.py` → truncation/causality, warm-up, PO/EMA parity, ETH-vs-RTH conviction check.
- Live loop writes signals_v2.jsonl (old signals.jsonl kept). Baseline frozen: git tag `baseline-v1`, folder baseline_v1/.
