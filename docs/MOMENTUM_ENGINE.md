# Momentum tracker v1

This is a signal-only observation engine. It replaces the public live strategy
stack; the existing research engines remain separate. It has no broker or order
code. The primary observation is the first qualifying event across SPY, SPX,
AAPL and GOOGL, with a permanent one-observation-per-session budget. A secondary
candidate is a watch-only research line and cannot consume another live entry.

## Frozen rules

- Use confirmed regular-session 3m bars and the session's completed-daily ATR.
- Events are the first confirmed crossing of each ±23.6 trigger in its direction,
  a subsequent trigger retest, or a pre-market low hold / high rejection. Opening
  gaps already outside a trigger do not count as a crossing by themselves.
- A boundary touch means the bar reaches within 0.03 ATR of the level and closes
  back on the signal's side. Consecutive boundary-touch bars are one visit.
- A trigger retest is rearmed only after an entire bar has moved more than 0.05
  ATR onto the signal's side. Its later touch/close is a new candidate. These
  small tolerances are explicit implementation assumptions, not replay-proven
  enhancements or the separate old TRIGGER RETEST shadow strategy.
- Entry is the next bar's observed open, strictly before 15:00 ET. A confirmed
  1m bar can establish that open before the full 3m bar completes. Until then the
  entry remains unknown; the reserved card says WAIT.
- Skip same-time RVOL **greater than or equal to 1.5**. RVOL is event-bar volume
  divided by the median volume in the identical regular-session 3m slot over
  the previous 20 calendar sessions scheduled to contain that slot. An early
  close without an afternoon slot is excluded by the calendar, not counted as
  missing data. Every expected 3m bar in the selected sessions must be present
  with valid volume. Missing data in an eligible session is never replaced by
  an older session; insufficient history or zero baseline yields DATA HOLD.
  SPX explicitly uses SPY volume.
- There are no VIX, EMA/ribbon alignment, calendar-data-day or confidence-score
  gates. The old standalone Level Bounce and Box Break streams are not this
  tracker. Trigger escape is an event within the single momentum policy.
- Simultaneous events use a fixed ticker order: SPY, SPX, AAPL, GOOGL; within one
  ticker, trigger escape precedes trigger retest, then pre-market boundary
  events. Opposing directions on one ticker's same confirmed bar are withheld
  rather than arbitrarily picking a side. Future performance is never used to
  break a tie.

## Outcome and plain-English status

The primary milestone is **0.236 ATR from the actual observed entry**, with no
requirement that entry sit on a Saty level. The next Saty ladder level is shown
separately. Crossing a shorter ladder interval does not silently substitute for
the primary milestone. Each distinct directional ladder level beyond entry is
counted once, and favorable/adverse excursion is retained.

The milestone must occur before either a 0.3 ATR adverse price touch, a confirmed
3m close more than 0.1 ATR through the defended level, or the time exit five
minutes before the exchange close (15:55 on a full session). Target and stop
within a bar are stop-first unless available confirmed minute bars prove the
order; a gap at a known bar open has its actual ordering. Missing price history
or the exact time-exit minute remains unresolved rather than inventing a result.

Reaching the milestone latches a momentum win but **does not automatically exit**.
Tracking continues until the original invalidation or time exit. HOLD means the
observation remains intact. GET READY TO EXIT is an alert when price is within
0.05 ATR of either stop boundary or the not-yet-reached milestone; it never
calls for profit-taking. EXIT supplies the plain-English failure/time reason.
These status cues do not claim separately validated probabilities.

## Persistence, causality and statistics

`replayMomentum(inputs, calendar, {now, sessionDate, reservation, entryAfter})`
accepts internal per-ticker `{snapshot, history, overnight, one_bars}` data. Raw
history is used for RVOL and must not be shipped as the public market response.
The live reader supplies the earliest allowable entry time so an old replay
winner cannot become a new live alert. `entryAfter: Infinity` prevents new
selection. An existing same-session reservation always wins over newly arrived
history, keeps its observed entry, and preserves a latched milestone. A closed
record is immutable. Durable compare-and-swap storage is the reader's job.
`validMomentumReservation()` validates the frozen record and price geometry;
malformed records or a changed price-source fingerprint fail closed.

`momentumStats()` counts a milestone outcome as resolved when the milestone has
been reached or the observation has closed. It separately reports closed-green
outcomes and PF for the stated tracking exit policy. Rates are suppressed below
n=20, while counts and Wilson intervals remain available. Unresolved outcomes
are explicit. These records are not pooled with old strategies or reported
replays. Carter's reported 56% on 64 **5m sessions** (95% CI 44–68) and weekly
walk-forward 58% are labeled unverified baseline provenance, not results for
this newly filtered 3m policy.

The engine tests cover the RVOL boundary/history/proxy, confirmation timing,
next-open prices, first-event selection, sticky reservations, retests, mirrored
puts, target/stop ordering, minute-level ordering, structural close failure,
exact time exit, missing data and separate milestone/closed-green statistics.
