# Public access and the Pages mirror

## Open the dashboard

**Primary public URL:** https://saty-plus-trading-desk.zestyfawn9.chatgpt.site/

The Site audience is public. No ChatGPT account or sign-in is required for market panels, levels, setups, development evidence, learning or the playbook. Bookmark the URL or use the browser's Add to Home Screen option for one-click access. Owner sign-in appears only in the optional private paper journal.

**GitHub Pages URL after enablement:** https://carterwaynereed.github.io/SATY/

Both hosts serve the canonical `site/` frontend. Pages requests the public home's `/api/market` every 15 seconds while visible and `/api/evidence` about once a minute, with conditional ETags and omitted credentials. It receives the same cached confirmed bars and matching development evidence. The ten-minute Action still maintains reference/audit JSON; it does not determine the mirror's live refresh rate.

## One-time GitHub Pages setting

1. Open [SATY Settings → Pages](https://github.com/carterwaynereed/SATY/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**. The repository already has its workflow; no suggested template is needed.
3. Open [Update shared data and Pages mirror](https://github.com/carterwaynereed/SATY/actions/workflows/dashboard.yml), choose **Run workflow**, select `main`, then **Run workflow**.
4. Wait for **Deploy GitHub Pages** to succeed, then open the Pages URL above. Later pushes to `main` deploy the mirror automatically.

The available GitHub connector does not expose the repository Pages setting. Adding `enablement: true` to `actions/configure-pages` with the default `GITHUB_TOKEN` does not supply the administration permission required to create a Pages site. See the [official action inputs](https://github.com/actions/configure-pages/blob/main/action.yml) and [GitHub's publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Private records remain private

The original paper journal stays in its existing R2 record. Anonymous visitors are denied `/api/snapshot` and `/api/update`; CORS is granted only to the two public read endpoints. The owner's platform identity permits journal reads. The scheduled updater needs a scoped service credential held in the Site runtime. Browser-local imported journals and notes stay in that browser.

External monitors must take the updated `sync-site.mjs` from `main`. They continue supplying the same hidden-stdin Sites access JSON. The helper derives and sends the new application credential in memory. Older uploader copies are rejected. No credential is stored in GitHub, browser code, an Action, or these docs. See [the updater runbook](desk-site-data-sync.md).

## Verification and future source changes

Run `node hosting/verify-public.mjs` for anonymous homepage/API checks, CORS/preflight/304 behavior, private endpoint denials and deployed asset equality. Run it with `--require-pages` once Pages is enabled. A closed-session reference is not a feed failure; original confirmed-bar timestamps remain visible.

Site code publication remains a separate supported release from GitHub. To publish a future main change to the home, ask:

> Sync current carterwaynereed/SATY main to the existing Saty+ home and publish it, preserving its public audience and private journal.

The public market/evidence transport is shared continuously even when UI source publication is pending. No permanent GitHub-to-Site deployment token or webhook is installed.
