# The Saty+ home and public mirror · 0.3

**Home:** https://saty-plus-trading-desk.zestyfawn9.chatgpt.site/

The existing owner-private audience, Site identity and R2 `BUCKET` are preserved. The optional GitHub Pages mirror has the same frontend source but no private journal or live Worker endpoint. The home remains the primary desk.

## Shared source, different data transports

`site/` is the canonical buildless HTML/CSS/JS/canvas frontend. There are no npm dependencies, external fonts, framework runtime or chart libraries. `hosting/build.mjs` bundles the public assets and required market/paper modules into a Worker ES module. Validation enforces a 500 KB static asset budget, including all four ticker seeds and development evidence.

On the home, `GET /api/market` reads the no-login public TradingView chart WebSocket for SPY, SPX, AAPL and GOOGL through `lib/tradingview-feed.mjs`. The common `lib/saty-live.mjs` replay uses the frozen default SATY rules. The browser polls every 15 seconds. The Worker coalesces requests and caches history until a new confirmed 3m bar is due, approximately its boundary plus five seconds. ETag/304 responses avoid retransmitting unchanged market JSON. Browser freshness still advances with time.

Full-session monitoring runs 09:30–16:00 ET, respecting the exchange calendar, independently of entry windows. Confirmed close age above 225 seconds in-session, invalid data or retrieval failure yields DATA HOLD. Opening-bar formation and closed-session reference states are explicit. The free endpoint's native 10m resolution was unsupported; ten-minute candles therefore require exactly ten completed 1m bars.

The market cache uses **`saty-plus/market-v2.json`**. It is separate from the original private journal. `lib/hosted-snapshot.mjs` retains **`saty-plus/desk-v1.json`**, its compare-and-swap writes, generated timestamps and schema. The original `GET /api/snapshot` and scheduled `POST /api/update` contract remain intact. Sites authenticates the private audience before requests reach the Worker; do not deploy this journal binding on a public origin.

The original local scanner remains in `scan.mjs`, `ingest.mjs`, `server.mjs` and `sync-site.mjs`. Its ignored `/data/` directory is never synchronized to GitHub or embedded in the site. Its paper engine is separate from SATY. No broker, order or automatic webpage paper-trading service exists.

Pages reads scheduled `market.json` from `dashboard-data`, with `tv-evidence.json`, legacy `latest.json`/`evidence.json`, manual `uw.json` and `learning.json`. Actions updates the reference about every ten minutes; that interval must not be described as the home's live refresh rate. The home fetches its own market data and does not depend on an Action finishing on time.

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
6. Use the Sites source helper to push/package that exact checked source commit, then save/deploy through the owner-private native Sites operation. Retain returned version/deployment IDs and stop on terminal status. Verify the deployed market endpoint and that the original private journal count/hash remain preserved. Main and Site publication are separate, explicit releases.

Credentials belong only in session memory and the helper's hidden stdin, never command arguments, repository files or logs. Existing audience and storage identity must not change during a code sync.

## Evidence and verification

The new evidence bundle contains 34 same-feed development sessions for every ticker. Source fingerprints include actual TradingView symbol/source metadata, RTH basis, 3m interval and split adjustment. Setup headlines require n ≥ 20 plus matching feed, horizon and chronology. The UI retains named events, hits/n, Wilson intervals and DEVELOPMENT state when a headline is withheld. The source audit is [docs/TV_EVIDENCE.md](../docs/TV_EVIDENCE.md).

`node --test tests/*.test.mjs` covers routes, private storage, live-feed parsing/cache behavior, evidence math, freshness, target gates and Python-to-JS engine parity. Python tests cover calendar/causality, evidence reconstruction and durable observations. The committed `docs/saty-plus-live-preview.jpg` is an actual QA interface capture, not a promise that its displayed values are current.

`verify-live.mjs` is the optional read-only deployed-site check. Start it with a PTY and supply the freshly obtained Sites bypass credential through hidden stdin. It reports market summaries and a private journal count/checksum without exposing journal rows or the credential. It does not write the private snapshot. A market check must distinguish fresh confirmed bars from a dated bundled/reference response; opening the page alone is insufficient verification.
