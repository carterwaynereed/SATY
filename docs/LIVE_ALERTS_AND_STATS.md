# Corrected outcome metrics and shared live alert desk

**Target hit %** is the fraction of closed model episodes reaching the full
specified target before the stop (stop-first ties). A 0.3 ATR first scale is a
separate milestone, never counted as the full 0.4 ATR target. **Closed green %**
means final weighted realized underlying model return >0, including time exits
and partial-scale/stop exits. PF is positive modeled returns / absolute negative
modeled returns. Missing target classification, absent sample sizes and zero-loss
PF stay unavailable. No invented rates. Small newly measured n<20 rates withheld.
Legacy win-rate fields remain for compatibility but UI labels them closed-green,
never target success. Target-only legacy evidence shows green/PF unavailable.

Level Bounce is **LOW CONFIDENCE**: user-corrected 13-week replay 47% closed green,
PF0.92; target-hit rate and n not supplied. Old five-week 70% claim is withdrawn.
Forward measurement starts October 26, 2026. Its entry/exit mechanics remain v1;
the shared admission policy below now supersedes earlier per-policy daily limits.
All original shadow strategies stay hidden and unchanged in behavior. Shared
statistics add explicit target-hit / closed-green fields alongside legacy fields.

Three new confirmed-3m, next-open alert candidates:
- ON-Low Hold + VIX Fade CALL: low tests overnight low (within 0.05 ATR or below)
  then closes above; latest fresh 3m VIX below confirmed native 15m EMA21.
- Morning High Rejection PUT: freeze the first **60 minutes** at 10:30 ET;
  subsequent high tests that high (within 0.05 ATR or above), closes back below;
  latest confirmed native 1H close below EMA21. Slow fade / trail-hold emphasis.
- Call Trigger Break from Box CALL: first RTH open inside inclusive ±23.6 box,
  confirmed close crosses from at/below to above +23.6 trigger.

A/B consecutive touches are one episode until price leaves the tolerance area
or closes through the level and reclaims/rejects again. Missing overnight means
no A (SPX has no extended session); missing native intervals means DATA HOLD for
that setup. Native EMA21 needs 60 complete, contiguous recent interval bars and
the latest expected close. 1H aligns at exchange open, final partial hour ends
at session close. No future candle affects an earlier decision. New alerts use
the existing CPI/PPI/NFP/FOMC and monthly OPEX guard; uncovered dates hold.
Existing event coverage is Oct–Dec 2026. No additional start-time restriction is
invented for A/C; B cannot start before its first-hour range is frozen.

Management assumptions (made concrete because scale fraction/trail distance
were not supplied): next contiguous confirmed candle's open is modeled entry;
stop 0.35 daily ATR; half scales at 0.3 ATR; remainder exits at 0.4 ATR target.
After scale, stop ratchets 0.35 ATR behind confirmed close, effective next bar.
Otherwise hold to stop, target, or exact 15:55 minute (close minus five minutes
on early-close dates). No pre-scale early cut or breakeven. Missing exact minute
remains unresolved. Gaps use open; ambiguous intrabar stop-first. Scale proceeds
and remaining realized return both contribute to closed-green and PF. The
reported replay results below were not independently reproduced with these
specific management assumptions.

Shared daily admission across **all live setups**, including MAIN and Level
Bounce: aim for 1–2 best qualified alerts, never force a quota; hard max **5 total**,
max **3 per ticker**, one active/pending position per ticker, 30 minutes after a
strictly losing trade, no new entries at/after 15:00 ET. Simultaneous candidates
rank confidence then supplied PF, then deterministic ticker/ID. All three new
setups rank MEDIUM (B small n, C unstable); Level Bounce LOW, MAIN uncalibrated LOW.
Ranking never uses future session results. Earlier admitted alerts cannot be
replaced by higher-PF data arriving late. Pending-to-filled is the same stable ID.

R2 conditional writes (`etagMatches` / `etagDoesNotMatch`) reserve the shared
budget at `saty-plus/live-alerts-v1/YYYY-MM-DD.json`. Conflicts retry; failed
persistence withholds new instructions. No private journal keys are touched.
Raw MAIN/shadow research still records its original candidate policy; shared
admitted alert evidence is separate, never relabeled as the old WAIT ledger.
Existing Actions cadence adds cached VIX15 capture and an idempotent replay-only
review under `state/live-alerts/`, reusing archived native hourly inputs. It does
not claim replay-only models were delivered live or filled by a broker.

Reported 13-week A: Target hit38%, first-scale44%, closed-green74%, PF3.6; n not
supplied. B: target-hit not supplied, closed-green approximately82%, PF2.9, n22
on 3m; replay duration not supplied. C: target-hit48%, closed-green75%, PF3.4;
unstable / MEDIUM; n not supplied. These are user-supplied descriptive summaries,
not calibrated probabilities; raw trades, costs and complete rules were absent.
No pooling of reported data into newly measured n; signal-only, no orders.
