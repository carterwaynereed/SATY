# Architecture and operating assumptions · 0.3

The canonical source is SATY `main`; the existing Saty+ Site remains the home. Plain HTML/CSS/JS and canvas serve both the home and optional Pages mirror. The home adds a dependency-free Worker and keeps its existing owner-private audience. Static asset validation enforces a 500 KB budget including four-ticker seed data. There are no broker or order endpoints.

## Home live path

1. The browser polls same-origin **`GET /api/market` every 15 seconds** while visible. A bundled four-ticker snapshot supplies identifiable first-paint context until retrieval completes; its original timestamps are retained.
2. The Worker opens the public, unauthenticated TradingView chart WebSocket for SPY, SPX, AAPL and GOOGL. It records resolved source metadata, observed delay, symbol attempts and a source fingerprint. Primary symbols are `AMEX:SPY`, `TVC:SPX`, `NASDAQ:AAPL` and `NASDAQ:GOOGL`; SPX can fall back to `SP:SPX` with its actual delay disclosed.
3. Only completed RTH 3m bars enter the common JS port of frozen `saty-sig-2.0`. Replay requires 400 continuous prior 3m bars, the display session's opening sequence, and at least 100 completed daily bars. ATR uses daily sessions strictly before the display session. The free endpoint's native 10m request was unsupported, so trend candles require exactly ten completed 1m constituents aligned to the session open.
4. In-memory request coalescing and a separate R2 market cache avoid repeated history downloads. A successful snapshot is reused until the next 3m boundary plus approximately five seconds. Failed feeds are retried on subsequent eligible polls. The API uses an ETag and returns **304** for an unchanged representation; the browser independently ages the retained bar timestamp.
5. The exchange calendar permits monitoring throughout **09:30–16:00 ET**, including periods outside setup entry windows, and supplies holidays/early closes. During an open session, a confirmed-bar close more than **225 seconds** old is held. Missing, invalid or failed feeds also produce DATA HOLD. Opening-bar formation and a completed closed session have separate reference states.

The displayed price is a confirmed bar close, not a tick quote. Source metadata without an explicit real-time declaration is not converted into a guaranteed exchange-real-time claim. A healthy historical download cannot make delayed bars current. SPX volume is unavailable and its VWAP vote is neutral.

## Directional rows and setup eligibility

The six evidence weights are 25/25/10/15/10/15 for 3m ribbon, 10m ribbon, 13/48 conviction, VWAP, daily ATR trigger and a newly confirmed trigger. Bullish and bearish row totals are computed from each ticker's actual bars. Equal opposing weight is moved to WAIT; neutral weight also remains WAIT. The allocation sums to 100.

Fresh in-session allocations remain visible when entry windows or setup rules say to wait. **Evidence direction and entry eligibility are distinct outputs.** Unusable or out-of-session data overrides allocation to 0/0/100. The UI exposes the row math and labels every allocation as an evidence weight, never an event probability.

SATY entry windows and context detector windows remain frozen; observing the market through 16:00 does not extend those rules. The original paper scanner stays a separate model with its own windows, cost/time-exit assumptions and journal.

## Storage boundaries

| Record | Location | Purpose |
| --- | --- | --- |
| Live market cache | R2 `saty-plus/market-v2.json` | Public-source bars and same-engine snapshots; independent of the private journal |
| Original private paper snapshot | R2 `saty-plus/desk-v1.json` | Preserved journal, generated timestamp and compare-and-swap update contract |
| Static reference and supporting data | GitHub `dashboard-data` | `market.json`, `tv-evidence.json`, legacy `latest.json`/`evidence.json`, `uw.json`, `learning.json` |
| Frozen source, evidence captures and rules | GitHub `main` | Reviewed code, raw compressed public history, development ledgers, manual inputs and learning registry |
| Private local scanner state | Ignored root `/data/` | Original monitor state; never copied into public assets or GitHub |

`GET /api/snapshot` and the scheduled `POST /api/update` retain the original private paper contract. Sites authenticates the owner-private origin before Worker access. Pages has no private journal endpoint. External public-data requests omit Site credentials. Public source data and personal journal rows are never combined into a publicly deployed snapshot.

## Scheduled mirror and durable observations

GitHub Actions continues its approximately ten-minute XNYS-gated schedule, covering both New York UTC offsets and finalization through close + 15 minutes. `scripts/refresh_tv_market.py` captures all four public TradingView feeds, then `scripts/build_market.mjs` runs the same JS engine to produce `market.json`. This is a **scheduled reference** for static Pages, not the hosted home's live transport. A delayed Action cannot meet the one-bar target.

The original Python refresh also preserves the public observation/outcome audit. First observations retain source, geometry, decision/observation times and the evidence available at receipt. Later outcomes, changed provider data and replay-membership revisions are separate append-only records. Restart recovery reconstructs first-observation IDs; outcome consumers deduplicate `(id, outcome_hash)` and membership revisions by `(id, kind, price_asof)`. A setup discovered after its modeled next-open entry is not certified timely forward performance.

The workflow persists generated files without changing `main` and optionally deploys `site/` to Pages. It does not rely on a generated-branch `GITHUB_TOKEN` push starting another workflow. Manual UW and learning edits originate on main; scheduled data generation does not overwrite their source files. Pages configuration, feed retrieval and persistence failures remain distinguishable.

## Evidence and rule boundaries

The original Python engine and supplied statistics remain protected by SHA-256 manifest checks. New same-feed development evidence separately replays **34 complete sessions per ticker, September 4–October 22, 2026**. Captured daily/intraday data and stable episode ledgers are compressed under `stats/tv/`; the browser reads compact `tv-evidence.json`.

Each cell names ticker, feed fingerprint, setup, cohort, target index and reward/risk bucket. It counts a target touch before the original stop by the 16:00 horizon, with next-open modeled entry, gap cancellation and uniform 3m stop-first ambiguity handling. Hits/n, episode/session counts, Wilson 95% descriptive intervals and target-first sensitivity remain visible. A headline requires n ≥ 20 and verified source/chronology/horizon compatibility. Evidence built after a decision cannot become a forecast made at that decision.

All cells remain **DEVELOPMENT**. Direction is pooled within a cell; overlapping episodes and sessions are correlated. Wilson does not adjust for clustering. Neither counts nor the legacy calibration diagnostics establish live predictive skill. The JS port's 140-session-case parity test compares price references, indicators, 994 entry candidates and barrier outcomes to unchanged Python.

The engine's RTH 13/48 convention is explicit and differs from Saty's extended-session implementation described in the supplied audit. Manual gamma/flow/dark-pool observations remain context, with source time, method, expiry scope and instrument basis. Missing is null; stale or mismatched levels do not join a ladder. These inputs do not alter frozen rules or probabilities.

Learning candidates require a sourced hypothesis, preregistered challenger and reviewed promotion with rollback. Appending a lesson or rebuilding a dataset is not an automatic production rule change.

## Code release boundary

A main push updates Actions/Pages; it does **not** permanently redeploy the private Site. Current Sites tools expose short-lived source credentials and short-lived publish-on-push behavior, not a permanent GitHub-to-Site webhook. A Site token is never embedded in Actions or this repository.

The complete one-step user request is: **“Sync current carterwaynereed/SATY main to the existing Saty+ home and publish it, preserving its audience and journal.”** The Sites-enabled assistant then opens the existing checkout, synchronizes reviewed tracked source, validates, packages and publishes it. `node hosting/sync-source.mjs /absolute/existing-site-checkout` performs source copying only. See [the operator release procedure](../hosting/README.md).
