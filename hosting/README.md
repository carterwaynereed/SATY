# The Saty+ home and public mirror · 0.3

**Home:** https://saty-plus-trading-desk.zestyfawn9.chatgpt.site/

The home is public without a login, at Carter's explicit request. Site identity and the R2 `BUCKET` are preserved. GitHub Pages serves the same frontend and reads the home's public live API. The paper journal has separate application authorization and is never available to anonymous readers or to Pages. The home remains the primary desk.

## Shared source and live data

`site/` is the canonical buildless HTML/CSS/JS/canvas frontend. There are no npm dependencies, external fonts, framework runtime or chart libraries. `hosting/build.mjs` bundles the public assets and required market/paper modules into a Worker ES module. Validation enforces an 850 KB total static artifact budget, including reference pages, all four ticker snapshots and generated research data. A separate 240 KB budget covers the initial Momentum Tracker and visible reference desk: its HTML, stylesheets and transitive static JavaScript dependencies are discovered from the actual entry point. A larger generated snapshot does not permit a heavier home screen. Both measurements use uncompressed bytes; API responses are separate.

On the home, `GET /api/market` reads the no-login public TradingView chart WebSocket for SPY, SPX, AAPL and GOOGL through `lib/tradingview-feed.mjs`. The common `lib/saty-live.mjs` replay uses the frozen default SATY rules. The browser polls every 15 seconds. The Worker coalesces requests and caches history until a new confirmed 3m bar is due, approximately its boundary plus five seconds. ETag/304 responses avoid retransmitting unchanged market JSON. Browser freshness still advances with time.

Full-session monitoring runs 09:30–16:00 ET, respecting the exchange calendar, independently of entry windows. Confirmed close age above 225 seconds in-session, invalid data or retrieval failure yields DATA HOLD. Opening-bar formation and closed-session reference states are explicit. The free endpoint's native 10m resolution was unsupported; ten-minute candles therefore require exactly ten completed 1m bars.

The market cache uses **`saty-plus/market-v2.json`**. It is separate from the original private journal. `lib/hosted-snapshot.mjs` retains **`saty-plus/desk-v1.json`**, its compare-and-swap writes, generated timestamps and schema. `GET /api/snapshot` now checks the signed-in owner's platform identity or a scoped service credential before reading storage. Scheduled `POST /api/update` requires that service credential; an Origin header is also rejected. Missing runtime settings fail closed. The public dashboard never requires owner sign-in.

Runtime secrets `SATY_JOURNAL_OWNER_EMAIL` and `SATY_JOURNAL_SERVICE_KEY` are configured with the native Sites environment tool, never in source or browser assets. The former comes from the verified owner's access-policy record. The latter is the lowercase SHA-256 hex of the UTF-8 string `saty-journal-service-v1` + a NUL byte + the current Sites service bypass token. The updated `sync-site.mjs` derives that credential in memory from its existing hidden-stdin token and sends `X-Saty-Journal-Authorization: Bearer <derived key>`. Dispatch consumes the original Sites header; it does not supply a visitor identity. Older uploader copies lack application authorization and must be updated. If the bypass token is intentionally rotated, update the runtime derived key and redeploy before resuming the updater. Never print either credential.

The original local scanner remains in `scan.mjs`, `ingest.mjs`, `server.mjs` and `sync-site.mjs`. Its ignored `/data/` directory is never synchronized to GitHub or embedded in the site. Its paper engine is separate from SATY. No broker, order or automatic webpage paper-trading service exists.

Pages requests the exact home `/api/market` and `/api/evidence`, with credentials omitted. Both endpoints permit read-only CORS for `https://carterwaynereed.github.io`, expose ETags, and support cached preflight and 304 replies. Private endpoints never grant CORS. Market and evidence caches are scoped by URL in the browser. The shared manual `uw.json` and `learning.json` still come from `dashboard-data`. Actions maintains scheduled `market.json` and legacy JSON for reference/audit; those files are not the Pages live transport. A failed live read leaves explicitly held/reference data, not a substitute live claim.

## Automatic deployment limit and one-step manual release

**Pushing to SATY main does not automatically publish Site code.** The exposed Sites capabilities currently offer short-lived source credentials and a short-lived publish-on-push option, not a persistent GitHub webhook or permanent deployment credential. No Site credential is stored in the public repository or GitHub Actions. Data and code publication are different operations.

For a complete manual release, make this **one user request** in the Sites-enabled chat:

> Sync current carterwaynereed/SATY main to the existing Saty+ home and publish it, preserving its audience and journal.

The assistant then performs the supported source-helper, validation, packaging and native deployment workflow below. This is a manual publication request, not an installed automatic sync.

For an operator who only wants to copy source into an already opened existing Site checkout, the one CLI command is:

```sh
node hosting/sync-source.mjs /absolute/existing-site-checkout
```

That command **copies source only; it does not build, push or publish the Site**.

## Six-step operator release procedure

1. Fetch current SATY main into the canonical checkout, preserve any local work, review/test changes and stage the complete intended source. Generated/private runtime files must remain excluded.
2. Call the native Sites get/open operations for the **existing Site**, obtain its current short-lived source credential and open the checkout with the Sites source helper. Retain the project ID, audience and `.openai/hosting.json` fields.
3. From the SATY checkout, run `node hosting/sync-source.mjs /absolute/existing-site-checkout`. It copies tracked source, removes obsolete tracked files and preserves destination identity, Git history and untracked private/runtime state. It does not copy `/data/`, `state/` or credentials.
4. Stage the Site checkout so removed tracked paths leave `git ls-files`, then run the sync command with `--check` to verify byte-identical source. Resolve discrepancies before packaging.
5. Build and validate the Site through the supported helper's ordered commands, or run `npm run build` directly when appropriate. No dependency installation is needed. The source manifest must retain the existing project ID and `r2: "BUCKET"`; omit `static` because Worker API routes are required. The build imports the resulting Worker and smoke-tests its index.
6. Use the Sites source helper to push/package that exact checked source commit, then call native `save_site_version` and `deploy_site_version` for the public audience. Retain returned version/deployment IDs and stop on terminal status. Verify anonymous public reads, denied private requests, matching assets and authorized private journal count/hash. Main and Site publication are separate, explicit releases. Do not use a private-only publishing operation for this now-public Site.

Credentials belong only in session memory and the helper's hidden stdin, never command arguments, repository files or logs. Existing audience and storage identity must not change during a code sync.

## Evidence and verification

The new evidence bundle contains 34 same-feed development sessions for every ticker. Source fingerprints include actual TradingView symbol/source metadata, RTH basis, 3m interval and split adjustment. Setup headlines require n ≥ 20 plus matching feed, horizon and chronology. The UI retains named events, hits/n, Wilson intervals and DEVELOPMENT state when a headline is withheld. The source audit is [docs/TV_EVIDENCE.md](../docs/TV_EVIDENCE.md).

`node --test tests/*.test.mjs` covers routes, private storage, live-feed parsing/cache behavior, evidence math, freshness, target gates and Python-to-JS engine parity. Python tests cover calendar/causality, evidence reconstruction and durable observations. The committed `docs/saty-plus-live-preview.jpg` is an actual QA interface capture, not a promise that its displayed values are current.

`verify-live.mjs` is the optional read-only authenticated check. Start it with a PTY and supply the freshly obtained Sites bypass credential through hidden stdin. It derives the scoped journal key and reports a private journal count/checksum without exposing journal rows or credentials. It never writes the snapshot. `node hosting/verify-public.mjs` checks anonymous access, exact-origin CORS, 304 replies, private-route denial and deployed asset identity. Add `--require-pages` after Pages is enabled. A market check distinguishes fresh confirmed bars from dated or closed-session reference responses; opening the page alone is insufficient verification.

## Exit panel and overnight-light

The shared `site/exit-panel.mjs` shows the selected ticker's latest tracking replay
setup, with a selector for older observations. These are signal-only references,
not tracked brokerage positions. Underlying-price targets use the directional
ATR grid through 100%; the just-completed bar cannot silently skip a touched
level. Original-stop touches take priority over target touches. A confirmed
close through the trigger or available 3m/10m 34 EMA marks invalidation. Closed,
stale and failed feeds never show a live green HOLD. Stop/target lines are drawn
on the main chart and a compact EOD chart.

Amber context cues use distance <=0.1 daily ATR, ribbon width <=0.03 daily ATR or
20% contraction, phase leaving +/-60 or crossing zero against the setup, the
existing confirmed pivot/phase divergence detector, and adverse RTH VWAP.
After 15:30 ET, same-ticker manual max-pain and the largest negative gamma node
can warn within 0.1 ATR only when observed within 15 minutes. Missing data is
UNAVAILABLE, never a false negative. These thresholds are unvalidated display
heuristics and do not alter the frozen entry engine. Frequencies are shown only
for an exact selected replay target with the engine's existing n>=20, chronology,
feed-match and Wilson gates. No separate exit-rule probability is claimed.

`lib/extended-hours.mjs` reads a distinct public TradingView `session: extended`
1m series plus regular daily reference history for SPY/AAPL/GOOGL. SPX stays
closed. Current-date confirmed extended bars must be <=125 seconds old;
unsupported/delayed/missing bars yield DATA HOLD. Premarket levels use completed
prior daily bars, not yesterday's ATR grid. The overnight range covers observed
prior-session after-hours plus current premarket; partial coverage is labeled.
After-hours levels retain today's grid, and gap preview uses the confirmed final
RTH close when available. A gap preview is a price difference, not a forecast.

The response adds an independent `extended_hours` map beside `symbols`; it never
passes extended bars to `buildLiveSnapshot`, recording, WAIT decisions, evidence,
or shadow promotion. Each equity entry also carries a `premarket` chart context:
confirmed 04:00–09:30 ET prints folded into 3-minute buckets, plus the pre-market
high/low, overnight range when prior after-hours prints were observed, and the
gap versus the prior regular close in price and daily ATR. Partial buckets are
omitted rather than filled. SPX stays closed. That context remains available
after 09:30 as left-side chart history. A cold Worker backfills it once during
the regular session; a warm pre-market read is not polled again after the open
except for one completion check before 09:33. It is still `stats_eligible: false`
and is not written into the private journal or the regular durable market cache.
Extended history is cached in memory/coalesced for 60s. Hourly ETH context is a separate native 60-minute read with `session: extended` for SPY, AAPL, and GOOGL. It reports hourly TTM squeeze (Bollinger 20, 2 inside Keltner 20, 1.5 ATR) plus the 10 and 21 EMAs on confirmed 04:00–20:00 ET bars. A forming hour is dropped and missing hours are not filled. Fewer than 40 confirmed bars, a delayed feed, or an hourly series with no pre-market or after-hours print returns DATA HOLD. SPX stays closed. The block is `session_basis: ETH` and `stats_eligible: false`; it is not passed to `buildLiveSnapshot`, evidence weights, or live entries. The desk loads it from a separate module. ChatGPT Site still needs its own republish after this is on main.
The browser polls at 15s during RTH, 60s during 04:00–09:30 / 16:00–20:00 ET, and
pauses automatically outside 04:00–20:00 and on weekends. Initial/manual reads
remain possible. The exchange calendar gates server reads, including holidays.
No GitHub Actions schedule was added or expanded.

## Carter score60 promotion and direction radar

The approved live overlay is `carter-score60-runner-1.0`; the frozen sig2 weights
and reference events remain unchanged. Read [the precise rules and causal fill
assumptions](../docs/APPROVED_RULES.md). The public market cache is now
`saty-plus/market-v3-approved.json` so an older cached response cannot omit the
approved state/radar after release. The private paper journal key and auth remain
unchanged. Both frontend pages show approved modeled positions, the 2-entry cap,
30-minute loss/flat cooldown, 15:00 entry cutoff, and per-ticker radar.

Every archived 3m decision carries its score components, lean and approved gate
state. Ledger IDs are versioned; old sig2 observations remain intact. The daily
review selects the approved version at cutover instead of double-counting both.
The existing after-close workflow additionally measures the registered no-runner
challenger and radar outcomes; no new scheduler or intraday cadence was added.
`policy-evidence.json` is persisted on dashboard-data, while raw paired records
remain in its `state/approved/` archive. Reported Oct 19–23 aggregates have their
own provenance and never count as prospective validation. No automatic promotion.


### Soft-cap and axis overlays (v1.1)

`carter-score60-softcap-1.1` permits three normal entries and one additional entry
only when the confirmed flip radar is >=55 and the ticker's already-realized
modeled session return is positive. No unrealized P/L or future candle score is
used. The same policy applies to both runner and no-runner variants. This is a
new frozen comparison; prior reported week results stay labeled as the prior
rules. The public cache uses `saty-plus/market-v4-softcap.json` to avoid serving
old entry state. Private storage and audience remain unchanged.
