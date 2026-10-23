# The Saty+ home and the public mirror

The existing home is https://saty-plus-trading-desk.zestyfawn9.chatgpt.site/.
Its existing owner-private audience, Site identity and R2 `BUCKET` are retained.
The GitHub Pages mirror is optional and contains no private journal endpoint.

## Shared source

`site/` is the canonical, buildless frontend for both hosts. There are no package
dependencies, fonts, chart libraries or framework runtime. `hosting/worker.mjs`
serves those same files and the existing private paper snapshot API. The
dependency-free build embeds only the public assets and the two small paper
storage/analysis modules in one Worker ES module.

`lib/hosted-snapshot.mjs` retains the exact R2 key `saty-plus/desk-v1.json`, its
compare-and-swap writes, generated timestamps and paper-journal schema. The
Sites access boundary remains responsible for authenticating private requests.
Do not deploy this Worker on a public origin with the private bucket attached.

The original local scanner remains in `scan.mjs`, `ingest.mjs`, `server.mjs` and
`sync-site.mjs`. Its `data/` directory is ignored and never synchronized to
GitHub or embedded in the website artifact. Its paper engine in `site/engine.mjs`
is independent of the Python SATY engine. No broker or order route exists.

## Source update procedure

1. Review and test changes in the SATY GitHub checkout. Stage the complete source.
2. Open this **existing** Site with the Sites source helper and its current
   short-lived write credential. Preserve `.openai/hosting.json` and its audience.
3. Run `node hosting/sync-source.mjs /absolute/existing-site-checkout` from the
   SATY checkout. It copies tracked source, removes obsolete tracked framework
   files and preserves the destination identity, Git history and untracked
   runtime/private files. It never copies `data/`, `state/` or credentials.
4. Run the same command with `--check` to verify identical source contents.
   After a sync, stage the Site checkout before this check so removed tracked
   paths no longer appear in `git ls-files`.
5. In the Site checkout run `npm run build`. No install is needed. Build requires
   the existing Site ID and `r2: "BUCKET"` in `.openai/hosting.json`; `static`
   must be absent because the private API needs the Worker.
6. Use the Sites source helper to push/package that exact source commit, then
   save/deploy it through the owner-private Sites operation. The public GitHub
   source update and the Site publication are separate explicit releases.

Both hosts continuously read the same four public JSON files from
`https://raw.githubusercontent.com/carterwaynereed/SATY/dashboard-data/`.
Scheduled **data** updates need no Site rebuild. A **code** change needs the
source synchronization/publication above; a GitHub push alone does not secretly
redeploy the private Site. No Site token is stored in GitHub Actions.

## Verification

`node --test tests/*.test.mjs` covers the preserved paper model, private storage,
Worker routes, stale data, evidence gates and manual context. The Worker build
also imports the final ES module and requests its index before packaging.

`verify-live.mjs` is an optional read-only deployment check. Start it with a PTY,
then supply the freshly returned Sites bypass token only through its hidden
stdin. It prints a journal count and checksum, never journal rows or the token.
The helper does not write a snapshot. Respect the Sites credential workflow;
never save credentials in a file or pass them in shell arguments.
