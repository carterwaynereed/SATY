# Level Bounce — user-approved LIVE signal only

Independent CALL/PUT setup on all four tickers, also selectable in the exit panel
and EOD chart. No orders, no actual position/fill claim, and no change to MAIN's
score60 rules, cap, cooldown, runner, evidence weights, WAIT ledger or challenger
promotion. 21 Pullback + VIX and TRIGGER RETEST remain hidden shadow research.
Separate live setups may disagree; this is not a combined portfolio allocator.

Setup candle: low <= chosen prior-day / prior-week / overnight low + 0.05 daily
ATR, strict close above it, green. Next consecutive confirmed 3m candle must be
green and close strictly above setup close. Puts mirror at highs. At that close,
confirmed intraday VIX must be below its completed-daily EMA21 for calls, above
for puts. Require 60 daily warmup bars and previous exchange-session daily VIX.
The VIX 3m observation must close no later than the decision and be <=225s old.
Current-day daily VIX is excluded. Missing VIX means DATA HOLD, not neutral bias.

Modeled entry at following contiguous 3m open: 09:45 minimum, or 10:00 when open
is inside the inclusive ±23.6 box or overnight range <0.35 ATR. Unknown overnight
(including SPX, no extended session) conservatively waits until 10:00 and omits
that level. Overnight comprises previous equity session 16:00–20:00 and current
04:00–09:30; complete endpoint bars required. Prior week is the completed previous
Monday–Sunday exchange week; incomplete weekly history omits that level.
No entry at/after 15:00 ET. Pending entries remain price-pending until the next
actual confirmed candle is available; no executable fill is asserted.

Fixed stop entry ±0.35 ATR; fixed target entry ±0.40 ATR. A put with decision-time
VIX <20 uses max(fixed target, daily -78.6 level); if that cap leaves no downside
room, skip it. Exactly three entries maximum per ticker in this setup, one at a
time; the requested 'soft cap 3' has no stated fourth-entry exception, so none
is invented. Thirty-minute cooldown after a strictly losing exit (flat is not
loss). No ribbon/opposite early exit, runner, breakeven or profit trim. Stop-first
for ambiguous candles; gap stop/target uses open. Intrabar exit timestamps use
bar close conservatively for cooldown. Time exit is exact minute ending 15:55,
or close minus five minutes on early-close sessions. Missing minute stays
unresolved/DATA HOLD. Missing 3m candles halt replay; never skip to a later fill.

`hosting/bounce-events.json` is verified against official BLS monthly schedules
and Federal Reserve meeting calendar, covering Oct–Dec 2026. CPI, PPI, Employment
Situation (NFP), and both FOMC meeting dates are excluded. Monthly OPEX is third
Friday shifted back to the previous exchange session when closed. Dates outside
verified coverage fail closed; update coverage before 2027 to enable this setup.
Sources:
- https://www.bls.gov/schedule/2026/10_sched.htm
- https://www.bls.gov/schedule/2026/11_sched.htm
- https://www.bls.gov/schedule/2026/12_sched.htm
- https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

Worker VIX context is shared across tickers and refreshed at most every 3 minutes;
successful overnight capture once per day (failed attempts at most every 10 min).
One initial reference fetch may occur on a closed exchange date; no recurring
closed-session fetches. No extra Actions schedule. Worker context and session
model logs use separate R2 keys `saty-plus/level-bounce-context-v1.json` and
`saty-plus/level-bounce/YYYY-MM-DD.json`; no private journal keys are read/written.
Existing intraday/EOD Actions independently measure the model using archived RTH
bars and captured VIX/overnight context, persisting `state/level-bounce/`. Only
sessions after registration count. First-observed and replay-late samples stay
separate. Original WAIT ledger remains untouched.

Displayed replay summary is user-supplied, not independently reproduced:
five-week OOS n=33; 70% wins, Wilson 53–83%, +4.02%, PF1.76, max DD -1.10%.
It is never added to newly measured n or described as a live win probability.
Small sample; raw trades/dates/symbol weights/costs were not supplied.
