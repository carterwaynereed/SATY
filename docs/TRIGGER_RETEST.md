# TRIGGER RETEST · signal only

Version `trigger-retest-1.0`, coordinated suite `saty-dual-setups-1.0`.
The main score60 setup remains separately named and measured. The suite permits
one modeled position per ticker and shares its 3-plus-qualified-fourth cap,
realized ticker P/L and 30-minute loss/flat cooldown across both setups. Main has
priority when both qualify on the same bar. No order or broker execution exists.

## Mechanical entry

All inputs are confirmed RTH 3m candles. The immediately following entry bar must
open at/after 10:00 and strictly before 15:00 ET. Earlier in this same session,
a close must have exceeded the directional +/-23.6 trigger by strictly more than
0.1 daily ATR. The retest candle low (CALL) or high (PUT) must be within 0.03 ATR
on either side of that trigger; its close must be back strictly beyond it.
EMA8/21/34 must be strictly stacked in that direction. CALL phase <+60; PUT
phase >-60. The current candle cannot establish its own earlier excursion.
No score60 threshold or ATR target-grid gate is added to this setup.

A qualified candidate models the next contiguous available 3m open. Missing
entry/outcome bars stay unknown. Stop = entry minus side*0.20 of entry-day ATR;
target = entry plus side*0.08 ATR. Gap stops use opening price and ambiguous
stop/target candles are stop-first. A flat result triggers the same cooldown.

Fixed target is the default. Optional runner scenario requires the last ribbon
known before the target-touch bar to still agree. It ratchets to target minus
side*0.05 ATR from the next bar and permits exactly one further 0.08 ATR leg.
No ribbon exit, opposite-score exit, automatic breakeven or phase<80 runner gate
is inherited from the main setup. At 15:55 (close minus five minutes on an early
close), a precise confirmed 1m time-exit close is required; otherwise DATA HOLD.

Both optional scenarios are server-replayed and recorded separately. Changing
the browser's runner view selects the entire ticker scenario, so main/retest
counts and cooldown stay consistent. It is a replay choice, not a broker action
or an assertion that the historical mode was traded. Main-chart overlays remain
for the main setup; the retest card names its own entry, stop and target prices.

## Evidence

The user reports five unseen walk-forward weeks: 84% wins, Wilson 74–91%, n=64,
+1.49%, PF 1.43. The raw trade list, exact dates, symbols, costs/weighting and
runner treatment were not supplied. The record is preserved verbatim as reported
research, not claimed to have been reproduced or pooled into app observations.
“High-probability, small target” is the requested study label, not a calibrated
probability or guarantee. No hit count is inferred from the rounded 84%.

The card shows separately accumulated first-observed n and Wilson intervals per
ticker and mode; headline win rates stay withheld below n=20. No resolved sample
means no CI. Replay-late outcomes have separate denominators. Win means positive
underlying modeled return, not an options return. Wilson intervals are descriptive;
session correlation and unmodeled costs remain limitations.

The existing intraday and EOD workflows update `retest-evidence.json`; complete
sessions are cached under `state/retest/sessions/` and raw records under
`state/retest/review.json`. Only sessions opening after registration are eligible.
A decision is first-observed only if its archived first receipt was within 225s
after that confirmed close. All per-bar candidates/gates are logged in the
versioned decision ledger, with fixed and runner scenario fields. No new schedule,
extended-session input, private-journal data or automatic promotion is introduced.
