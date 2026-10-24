# Saty 21 Pullback + VIX — hidden shadow only

This independent challenger logs modeled outcomes in durable `state/pullback-vix/`.
It has no card, live signal, alert, chart line, public JSON, journal write, broker
execution, WAIT-ledger input, promotion path, or effect on MAIN/TRIGGER RETEST.
Each ticker independently allows three entries, one open position, and 30 minutes
after a strictly losing exit. Flat trades do not start this strategy's cooldown.

Confirmed RTH 3m candles use the existing frozen EMA warmup and completed daily
ATR. A long needs EMA21 above five bars ago, low <= EMA21, close > EMA21 and
EMA34, and a completed fresh same-day VIX 3m close below the VIX daily EMA21.
Shorts mirror all inequalities, including VIX above its daily EMA21. The daily
VIX EMA excludes today's incomplete daily candle and needs 60 prior daily bars.
Missing/stale VIX means DATA HOLD, never a guessed trade.

The modeled next contiguous bar opens at/after 09:45, or 10:00 if the session
open is inside the inclusive ±23.6 trigger box or overnight range is strictly
below 0.35 ATR. Unknown overnight range conservatively uses 10:00, including
SPX, which has no extended session. Overnight is previous equity session
16:00–20:00 plus today's 04:00–09:30 ET, excluding the closed gap; all four
session endpoints must be present. Overnight bars never enter RTH indicators.
No entry at/after 15:00. Stops are entry ±0.25 daily ATR; targets ±0.50 ATR.
No runner, ribbon exit, opposite exit or breakeven. Stop-first on ambiguous
candles; gaps use the open. Intrabar exits are conservatively timestamped at bar
close for cooldown. Time exit uses the minute ending 15:55 ET, or five minutes
before an early exchange close. Missing exact minute remains unresolved.

Existing intraday/EOD workflows collect two VIX intervals and cache overnight
context once successful per day. No new Actions schedule or live polling.
Research source records remain in dashboard-data state, never site/data. Each
review rewrites deterministic per-session trades and decisions, preventing
repeated reviews from increasing n. Only sessions opening after registration
count. First-observed source receipts and replay-late results remain separate.
Statistics use closed modeled underlying returns (no fees/options modeling);
win rate is withheld below n=20, with descriptive Wilson intervals and n.

User-reported OOS five weeks: n=109, 54% wins, Wilson 45–63%, +7.23%, PF 1.40.
Raw trades, weeks, symbols, costs and weighting were not supplied. These results
are not independently reproduced and never pooled with newly observed samples.
The public deployment stays identical because this challenger is intentionally
absent from the Worker and all public UI assets. Private paper journal is untouched.
