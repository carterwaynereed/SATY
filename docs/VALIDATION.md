# v1 validation record

Validated locally on 2026-10-23 before the initial PR.

## Automated checks

- **36 Python unittest cases passed.** These cover exact target denominators,
  sample suppression, temporal/model availability, source mismatch, Wilson
  bounds, DST/holidays/early closes, incomplete candles, missing warmup/opening
  bars, current-day daily exclusion, stale/failure retention, actual signal
  serialization, managed-exit separation, immutable observations, deleted-index
  crash recovery, receipt-time stamping and withdrawn/restored replay events.
- A disposable local Git remote verified initial `dashboard-data` creation,
  restoration on a fresh checkout, preservation of journal data, subsequent
  updates, and an unchanged `main` commit throughout.
- Frontend Node invariants passed for missing versus zero values, snapshot age,
  clock checks, failed fetches, manual context expiry/method metadata, and
  probability headline suppression.
- Both workflow YAML files parsed; Python compilation passed.
- Strict JSON, input SHA-256 hashes, and the static artifact budget passed.
- A repository credential-pattern scan found no token/private-key matches.
  The literal `unauthorized_user_token` is the supplied public TradingView
  protocol marker, not an account credential.

## Read-only provider smoke checks

- **TradingView:** a successful real retrieval produced 94 confirmed session
  bars through 14:12 ET, four replayed setups, prior close 763.96 and ATR14
  7.369384. Metadata reported `source_id=BATS` with unverified delay. The page
  displayed that source and withheld headline probabilities because Cboe One
  parity was not established.
- **yfinance:** a successful independent fallback-path retrieval produced 96
  completed session bars through 14:18 ET and four replayed setups. Its source
  mismatch was explicit and headline probabilities remained suppressed.

These are point-in-time connectivity/serialization checks. They do not establish
future provider availability, feed equivalence, fill quality, or strategy edge.
Live smoke data and local caches are excluded from the PR. The committed initial
snapshot is an honest UNAVAILABLE state until a successful workflow refresh.

## Browser checks

Inspected the initial unavailable state and a real populated snapshot at desktop
width and in a 375px phone-sized content viewport. Neither viewport had page
horizontal overflow. Verified chart ribbon toggling, readable responsive chart
axes, source identity, replayed signal details, empty UW fields, evidence labels
and historical counts. No application-origin console errors were observed.

`dashboard-preview.jpg` is the final desktop preview from this check. It is a
dated local preview, not a production-deployment screenshot.

## Boundaries

The historical raw bars/ledger were not supplied. The full original audit was
therefore not independently reproduced; its report is preserved as supplied.
The RTH/ETH conviction discrepancy and development-sample limits remain visible.
GitHub's actual CI and Pages deployment results are separate from these local
checks. Pages requires the repository's publishing source to be GitHub Actions
and the workflow to exist on `main`.
