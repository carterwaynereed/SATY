# Momentum Tracker and reference desk

The light home screen puts one daily Momentum Tracker first, followed by a
secondary research watch, four direction-watch chips and display-only Unusual
Whales context. The full desk is visible below: ticker chart, ATR levels, Pivot
Ribbon and phase, directional evidence weights, reference setups, notes, and
the owner-only paper journal. End-of-day review remains directly linked. These
tools support review without becoming additional live signal streams.

Level Bounce, Box Break and prior score-based models remain labeled REFERENCE;
they do not feed the hosted live signal policy. Trigger escape remains an event
inside the single momentum policy, not another live card. Evidence weights are
context rather than probabilities. No order controls are exposed.

One controller, `desk.mjs`, owns ticker selection, data reads and polling. It
calls the pure `momentum-dashboard.mjs` renderer with that same market bundle;
the Momentum Tracker does not start a second reader or timer. The prior archive
URL remains available for existing links.

## Operational limits

- The Worker evaluates on market API reads; it is not a background alert service.
  Keep the dashboard open during the session. A new decision must be observed
  within 60 seconds, while its next-open entry is still pending. Missed events
  remain research rather than being backfilled as delivered alerts.
- The daily observation is shared across visitors through a separate conditional
  R2 record. New signals fail closed when persistence or required inputs fail.
  A second candidate is watch-only and cannot exceed the one-signal daily cap.
- Forward evidence starts October 26, 2026 with this rule version. Earlier replay
  results are labeled separately, including their timeframe and sample sizes.
  No 80% probability is claimed. Missing outcomes remain unresolved.
- The existing market polling cadence remains 15 seconds in the regular session,
  60 seconds during supported extended hours, and paused outside those hours.
  No new GitHub Actions schedules are introduced. Regular-session history is
  retained for same-time RVOL; extended bars do not enter momentum statistics.
- The repository and published UW data endpoint currently contain a placeholder,
  and no hosted UW provider credential is configured. The new box accepts the
  documented verified feed schema and displays DATA HOLD until values arrive.
  It does not use a connected user's tools as an implicit production feed.
- The owner-only paper journal uses its existing route, authorization and R2 key.
  No journal rows, credentials or private data ship in public assets.
- The complete static artifact stays below 850 KB, including the reference
  pages and generated four-ticker/research data. The initial home's HTML,
  stylesheets and transitive static JavaScript dependencies have a separate
  240 KB cap, measured without compression or API responses. The restored home
  currently loads about 224 KB across 20 local assets. Validation follows the
  actual dependency graph so a new import cannot bypass that home budget.

See MOMENTUM_ENGINE.md for frozen rules and UW_DISPLAY_CONTEXT.md for the display
contract. The local paper server remains an archive/research tool; the hosted
Worker supplies the durable momentum API.
