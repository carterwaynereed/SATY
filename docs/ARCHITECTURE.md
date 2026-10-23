# Architecture and operating assumptions

The shared browser frontend reads four compact JSON files from the public
`dashboard-data` GitHub branch. It never connects to TradingView, Yahoo Finance,
Unusual Whales, Discord, a broker, or an order endpoint. The original private
paper snapshot is read separately from the home Site’s same-origin authenticated
API. Public data requests omit credentials. The frontend uses plain HTML, CSS,
JavaScript, system fonts and a canvas chart; the private home has a minimal
Worker preserving its R2 journal API. See `hosting/README.md` for source release
and storage boundaries.

## Update path

1. GitHub Actions checks the XNYS session calendar. The ten-minute UTC cron covers
   both New York UTC offsets; the gate handles holidays and early closes.
2. A one-shot Python adapter fetches data through the supplied public TradingView
   reader, falling back to yfinance with the source identified. No account token
   or login is stored. Availability and latency are not guaranteed by either path.
3. Only completed regular-session bars enter replay. Daily ATR uses sessions before
   the decision session. The supplied `saty-sig-2.0` rules stay unchanged.
4. First observations and subsequent outcomes are written to durable public state.
   The `dashboard-data` branch holds generated state, keeping machine updates out
   of `main`. The workflow pushes without force and serializes deployments.
5. The same workflow optionally deploys `site/` with GitHub Pages when configured.
   The home does not depend on Pages availability. It does not rely on a
   `GITHUB_TOKEN` push triggering another workflow.
6. Source changes are copied from the canonical GitHub checkout into the existing
   Site checkout with `hosting/sync-source.mjs`, verified byte-for-byte, then
   packaged and privately published through the Sites workflow. Data changes
   require no Site rebuild.

`main` owns the code, frozen statistics, manual context, and learning registry.
The generated data branch owns the current snapshot and observation journal.

### Journal recovery and revisions

`observations.jsonl` is the authoritative append-only record of each event's first
receipt. If a process stops after an append but before its atomic `index.json`
save, the next refresh recovers event IDs and original receipt timestamps from
that session's observation file instead of appending another first observation.
Malformed journal data fails closed; it is not silently discarded.

Outcome records may repeat after an interrupted index save. Consumers must
deduplicate them by `(id, outcome_hash)` when counting unique outcomes; retained
append times remain useful for auditing receipt. Revision records describe
entry geometry becoming available, subsequent provider revisions, and events
being withdrawn or restored in a complete replay. Withdrawal is not inferred
from a stale snapshot or from an earlier price timestamp. A lost index can
repeat a revision record; deduplicate replay membership revisions by
`(id, kind, price_asof)` when reconstructing state.

For real requests, `generated_at` and new `observed_at` values are set after data
receipt. `health.request_started_at` preserves the beginning of retrieval so
download latency is visible. An explicit `--now` remains deterministic for tests
and replay. Model entries are still historical next-open references, never
certified executable forward entries.
When updating manual context, edit `site/data/uw.json` on `main`; a push triggers
publication. Automatic data refreshes do not overwrite that slot.

## What a snapshot means

The quote is a completed three-minute bar close with a timestamp. It is not a
streaming quote. Ten-minute scheduled replay can discover a setup after its
modeled next-open entry, target, or stop. An observation timestamp is distinct
from a signal's decision and modeled entry timestamps. The page does not mark
these old entries as new executable opportunities.

Freshness is recomputed in the browser as time passes. Feed errors retain
identifiable last-known values and show DATA HOLD; refreshing the page does not
make those values current. Scheduled observations are useful for latency and
source audits, but cannot by themselves certify timely entry performance.

## Strategy and evidence boundaries

The frozen engine uses RTH history, including its 13/48 conviction calculation.
The supplied audit reports a difference from Saty's extended-session conviction
ribbon. This dashboard is a documented Saty-inspired implementation, not a claim
of exact indicator or discretionary-trading parity.

The 34-session sample is development data. Target-specific descriptive counts
are separated by setup, cohort, target index and R bucket. Wilson intervals are
shown as descriptive intervals with a session-correlation caveat. The original
model's pooled-target calibration diagnostics are not validation of the new
target-specific display. A source change, unknown feed identity, temporal
leakage, or a thin cell suppresses headline estimates.

Unusual Whales values are manually supplied context. Gamma exposure is a vendor
estimate under a declared method and expiry scope; no gamma/flow input changes
the frozen probability or entry rule. SPX levels remain on an SPX basis. Missing
values are null, never an assumed zero.

## Source preservation

`engine/` contains the supplied Python files unchanged. `stats/` contains the
supplied statistics unchanged. `docs/engine-manifest.json` records their SHA-256
hashes and is checked in CI. Original audit scripts require raw historical files
that were not included in the bundle; their prior results are supplied claims,
not a newly reproduced full historical audit.

The adapter has its own tests for timestamps, incomplete bars, state persistence,
thin evidence and failure handling. New strategy proposals live in `learning/`
and require a separate review/version change before promotion.

## Relevant platform documentation

- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Configure the Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars)
