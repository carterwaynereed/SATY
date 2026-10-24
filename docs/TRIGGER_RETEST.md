# TRIGGER RETEST · hidden shadow challenger only

Carter withdrew the request to expose this tiny-target setup before publication.
It is **not a live setup**: no dashboard card, browser toggle, chart overlay,
public market-API field, production decision, or change to MAIN risk gates.
No orders, automatic promotion, or new scheduler are introduced.

The research-only modules are `lib/setup-shadow-engine.mjs` and
`lib/trigger-retest-shadow.mjs`. Production `site/`, `hosting/build.mjs`,
`lib/approved-policy.mjs` and `lib/live-market.mjs` remain unchanged. The shadow
suite models MAIN/retest together for research, but never imports into the live
engine or alters its counters, cap, P/L, cooldown, alerts or positions.

## Frozen hypothesis

Version `trigger-retest-1.0`, suite `shadow-trigger-retest-suite-1.0`.
Confirmed RTH 3m bars; next entry open >=10:00 and <15:00 ET. Earlier that same
day a close must be strictly >0.1 daily ATR beyond the directional +/-23.6 trigger.
The retest low (CALL) / high (PUT) must be within 0.03 ATR of the trigger and
close back strictly beyond it. EMA8/21/34 must stack in direction; CALL phase
<+60, PUT phase >-60. The current candle cannot establish its own prior excursion.

Shadow entry at next contiguous bar open. Stop = entry minus side*0.20 daily ATR;
target = entry plus side*0.08 ATR. Fixed-target and optional-runner hypotheses
are recorded separately. A runner requires the ribbon known before the target
bar to agree; stop ratchets from the next bar to target minus side*0.05 ATR,
with one equal 0.08 ATR extra leg. No ribbon/opposite-score exit or automatic
breakeven. Time exit 15:55 (five minutes before early calendar close) requires
its exact confirmed 1m close. Missing bars remain unresolved; stop-first ties.
A fixed target touched in the final minute precedes the time close.

Only inside the shadow simulation: one position/ticker; MAIN wins simultaneous
candidates; the modeled soft cap and loss/flat cooldown are shared across those
hypotheses. This does not change production MAIN or register a second live entry.

## Evidence and persistence

The supplied five-unseen-week summary is preserved as reported: 84% wins,
Wilson 74–91%, n=64, +1.49%, PF 1.43. Raw outcomes, exact dates, symbols, costs,
weighting and runner treatment were not supplied; it is not independently
reproduced or mixed into collected shadow samples. No hit count is inferred
from the rounded 84%. No performance claim is displayed on the Site.

The existing intraday and EOD jobs run `scripts/review_retest.mjs`. Research
configuration is `learning/trigger-retest-shadow.json`, outside the UI-facing
learning registry. Outputs live only under dashboard-data `state/retest/`:
`evidence.json`, raw `review.json`, and cached complete resolved sessions. These
are public-repository research records, not private-journal data. No retest JSON
is placed under `site/` or copied into the normal public dashboard bundle.

Only sessions opening after registration count. Source bars first received within
225 seconds of the confirming close are separated from replay-late inputs.
All episodes remain shadow simulations, never executed trades or live alerts.
Wilson intervals are descriptive and session correlation/costs remain limitations.
