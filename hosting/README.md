# The Saty+ home and public mirror · 0.3

**Home:** https://saty-plus-trading-desk.zestyfawn9.chatgpt.site/

The home is public without a login, at Carter's explicit request. Site identity and the R2 `BUCKET` are preserved. GitHub Pages serves the same frontend and reads the home's public live API. The paper journal has separate application authorization and is never available to anonymous readers or to Pages. The home remains the primary desk.

## Shared source and live data

`site/` is the canonical buildless HTML/CSS/JS/canvas frontend. There are no npm dependencies, external fonts, framework runtime or chart libraries. `hosting/build.mjs` bundles the public assets and required market/paper modules into a Worker ES module. Validation enforces a 750 KB static asset budget, including all four ticker seeds and development evidence.

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
