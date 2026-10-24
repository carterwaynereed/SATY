# Carter-approved score60 / runner rules · 2026-10-23

User-approved live signal-only overlay: `carter-score60-softcap-1.1` (supersedes the two-entry v1.0 overlay).
Prior release/rollback source: `40734ac55523a4706bb0606fe3d15c582eefb42a`.
The frozen sig2 engine and evidence weights remain reference inputs, unchanged.
The new decisions, trade episodes and radar have separate versioned identities.

## Confirmed-bar execution model

CALL >=60, PUT >=60, otherwise WAIT. A change from WAIT or the opposite side
into CALL/PUT is an entry candidate at the confirmed 3m close. It fills at the
immediately following available RTH bar's open in replay only. No fill is invented
when that bar is missing, stop geometry is invalid, or no target inside the 100%
ATR grid remains. A continuous same-side score never triggers another entry.
One modeled position per ticker, normally three filled entries/session, with a fourth only when the confirmed signal-bar radar is >=55 and this ticker's realized modeled session return is positive; no signal
or fill at/after 15:00 ET. Loss/flat exits start a 30-minute cooldown, including
10 full 3m bars. Cooldown expiry requires a new flip; it does not auto-enter.

Use a same-direction sig2 managed stop emitted on the entry-decision bar, else
that bar and its previous four bars' swing extreme. Stop gaps use next open;
stop/target intrabar ties are stop-first. A close through the 3m/available 10m
34 EMA, or back through an ATR trigger that was supporting entry, exits at that
confirmed close. Opposite score direction exits at that close. At 15:55 (or five
minutes before an early calendar close), exact confirmed 1m data is required;
a missing minute produces DATA HOLD/unresolved outcome, never a 15:57 proxy.

On target touch, runner eligibility uses the latest indicator state known before
that candle: agreeing 3m ribbon, direction-adjusted phase <80, touched target
within +/-100%, and a further target inside that same grid. This avoids using
unknown target-candle closing indicators to decide an earlier intrabar fill.
A qualifying touch ratchets stop to target minus side*0.1 daily ATR, effective
from the next bar; it never loosens. At most one target extension per bar.
Otherwise model a target exit (opening gap beyond target uses opening price).
Stop, support, opposite and time exits take priority. GET READY is alert-only
and never creates an exit or says to trim/take profit.

## Direction radar

Per completed RTH 3m bar, with prior RTH history for warm-up:

* ATR room: session range <0.60 daily ATR =20, else <0.80 =10.
* Squeeze: EMA8/34 width at/below the eighth sorted width in its trailing 40-bar
  window, at any bar of the latest 10. Two successive width increases =30 when
  squeezed, squeeze without expansion =12. No 40-bar history means no squeeze.
* Volume: >=1.5 times the previous 20 bars' mean =15; SPX always zero.
* Phase turning: slope newly turns toward the 3m ribbon's direction =10.
* Alignment: 3m and fresh 10m ribbons plus 13/48 agree =20; just ribbons =12.

The display scale is 0–100; the specified components sum to at most 95, and are
not silently normalized. >=55 highlights a directional arrow, never a big-move
forecast. No trigger-proximity term exists. Stale/closed chips remain labeled
reference/hold, not live heads-up. Chips sort by score and open their ticker.

## Evidence and ongoing comparison

`site/data/approved-rules.json` preserves the exact Carter-supplied week summary.
Those aggregates are reported, not reproduced or pooled into prospective results.
No-runner trade count was not provided and stays null. Likewise the reported
62–63% directional 60-minute frequency has n=652 but no raw event archive was
supplied; it is a reported development observation, not a calibrated live rate.

The no-runner challenger has identical entries/stops/gates but exits at first
ATR target. `scripts/review_approved.mjs` compares both after the existing daily
capture/review, on complete sessions opening after registration. Source snapshots
and the versioned decision ledger record every confirmed-bar radar score and
components, with first-observed versus replay-late timestamps. Ten-minute Actions
capture can backfill intervening 3m decisions; it is not continuous 3m observation.
Extended bars never enter this path. Raw paired outcomes persist in
`state/approved/review.json`; public `policy-evidence.json` contains counts and
session summaries. Radar validation uses exactly 20 future confirmed bars,
close-to-close direction, with insufficient horizons unresolved. Session correlation
is explicit. Thirty sessions/100 episodes permit human review only, never promotion.
No broker, orders, automatic rule optimization, or extra scheduler is introduced.


## Soft-cap / chart revision

The v1.1 fourth-entry exception uses only the sum of already-closed modeled
underlying returns for this ticker on this exchange session. Unrealized profit
never qualifies it; unresolved prior trades block that exception. The radar is
computed before replay and frozen on the confirmed flip, not read from the
future entry candle. A fifth entry is never eligible. Existing loss/flat cooldown
and 15:00 cutoff are unchanged. The UI says “Trades today x” without a denominator.
This new version is not validated by the older supplied week summary.

Both charts default to the next two ATR targets plus the modeled stop. “All
levels” restores the reference grid for that chart. Lines are thin/dashed at
30% opacity; rounded green/red/grey price-axis pills use a reserved gutter,
with collision spacing and gutter-only connectors. No overlay text is painted
in the candle area. The private journal is unchanged.
