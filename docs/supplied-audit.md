# Audit 1 — saty-sig-2.0 (baseline frozen: git tag baseline-v1 + baseline_v1/ code/stats/data)
Data: TV AMEX:SPY (Cboe One), 34 RTH sessions 9/04–10/22, 3m; 1m (from 10/05) for same-bar order.

## 1. Your first question
**No on both.** 09:39 trigger = opening gap, not a cross: open 759.89 already below −23.6/−38.2/−50; `armS` is True at session start, so the first eligible bar manufactured a "break"; entry was also past −61.8. 09:42 GG = repeated first-passage bug: detector ignored that −61.8 was already touched (9:33 low 759.41). And no: target stats used the fixed original stop to 16:00, while the exit log used the v3 managed rule.

## 2. Discrepancy table
| Finding | Cause / code | Fix |
|---|---|---|
| trigger 759.39 vs 762.22 | opening_gap + late (strategy_v2 arm init) | event_type fresh_cross/recross/delayed_confirm(≤3 bars)/pre_window/opening_gap + late flag → cohort fresh vs late/gap |
| GG after 61.8 hit | engine.py GG detector | 61.8 must be untouched; 1 episode/dir; re-attempt after close back through 23.6 |
| stop 762.22 vs exit 761.20 | managed exit: 3m close > 34 EMA (761.20 > 760.74); fixed stop hit 10:48 | P = fixed barrier; managed R separate |
| 51.7% (4/10) | K=10 toward prior 63.3% (pooled scalper P&L win) | shows observed 40% + smoothed + prior |
| ribbon T3 99/102 | 3 entries beyond ±123.6; ladder ends ±200 | determined at entry; targets frozen in ledger |
| identical 40.2% | stats keyed only by setup×target index | now conditioned on reward/risk |

## 3. Causality / parity
- Decide at 3m close, enter next open (cancel if beyond stop/T1); gap-aware; 1m resolves same-bar order, else stop-first.
- Truncated replay at 20 cutoffs/5 sessions: 0 mismatches. Warm-up 400 vs 1200 bars: 0 event diffs, max EMA diff 2e-7.
- ATR: Pine uses ext-session daily close[1], ta.atr(14)[1]; TV SPY daily ext = RTH; ours vs Pine RMA diff 1e-12.
- Phase Osc = EMA3((C−EMA21)/(3·ATR14)·100): matches Pine at 20 bars. **Bug fixed:** v1 warmed PO/Keltner ATR on closes only → PO off ≤86 pts at the open (display + squeeze KC only).
- Pivot Ribbon (original 8/21/34 + 13/48): Saty computes 13/48 on **extended-session** closes; we use RTH. Sign disagrees on 12.8% of RTH bars (35% before 10:30). Unchanged (ETH 3m only from 9/28).

## 4. Corrected baseline (T1 before original stop; Wilson 95%; mean realized move in ATR units, session bootstrap 2000, seed 42)
| setup / cohort | n (sess) | T1 hit | med T1 R | fixed-T1 ATR/trade | managed ATR/trade |
|---|---|---|---|---|---|
| trigger fresh | 18 (14) | 33% (16–56) | 1.92 | +0.001 (−.025,.033) | +0.059 (.009,.116) |
| trigger late/gap | 24 (23) | 79% (60–91) | 0.50 | +0.082 (.036,.121) | +0.084 (.034,.131) |
| GG open fresh | 19 (17) | 63% (41–81) | 1.12 | +0.065 (−.018,.143) | – |
| GG pullback pre-dest | 7 (6) | 6/7 | 0.48 | +0.078 | +0.067 |
| GG pullback post-dest | 34 (19) | 50% (34–66) | 0.89 | 0.000 | +0.010 |
| ribbon flip | 102 (30) | 39% (30–49) | 1.32 | −0.007 (−.035,.023) | – |
| squeeze | 14 (12) | 7/14 | 0.87 | −0.004 | −0.009 |
Before (v1, close entry): trigger 25/43, GG 19/29, GG-pb 23/41, flip 40/102, squeeze 7/14. Now also GG re-attempt 2/6, late 2/3.
Timeouts: flip 8, GG-pb 2, GG 1. Same-bar ambiguity 0 → stop-first = target-first. Fresh triggers: median risk 0.05 ATR → R explodes; hence ATR units.
All targets by RR (hit vs b/e): <0.5R 80% (>67), 0.5–1R 58% (50–67), 1–2R 41% (33–50), 2–4R 24% (20–33), >4R 5% (<20) → hits ≈ break-even; little fixed-barrier edge.

## 5. Probability model + chronological tests
p = (h+K·p_sb)/(n+K), p_sb shrunk to RR-bucket pool, K=10, training-only. Brier (same obs; new / old setup-only / pooled):
F1 train 1–20→21–25: .174/.188/.181 · F2 1–25→26–30: .204/.267/.269 · F3 1–30→31–34: .161/.218/.214 · expanding (410 obs): .166/.199/.203.
Reliability: 20–40% bin fc .32 obs .46 (n89); 40–60% fc .46 obs .38 (n112).

## 6. Open questions for you
1. Fresh trigger stop = trigger level → tiny risk. Min-risk floor (0.1 ATR) or 34 EMA?
2. Keep late/gap trigger as a "gap-and-go" cohort (best, but post hoc) or drop?
3. Switch 13/48 to ETH closes for parity (new version, short history)?
4. I split >2R into 2–4R/>4R after seeing the data. Keep buckets, or move to a regularized logistic on log(R)+setup?
5. Free TV feed caps 3m history ~38 sessions; worth a paid source?
6. Freeze saty-sig-2.0 now for the 20-session forward sample, then run your step 9 GG G0–G3 and step 11 stress grid?
Ledger: stats/ledger_v2.csv (230 rows, your fields + walk-forward prob/cutoff).
