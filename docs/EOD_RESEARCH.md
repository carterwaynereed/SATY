# EOD capture, public sync, decision history and executable shadow replay

## Release and access boundary

This release updates SATY source and its Actions/Pages deployment. The ChatGPT
Site still needs a supported Sites publication. Public Pages is at
https://carterwaynereed.github.io/SATY/eod.html. The native home is
https://saty-plus-trading-desk.zestyfawn9.chatgpt.site/.

The EOD page prefers the existing public market endpoint. If that deployment
predates the 1m field, it also reads `dashboard-data/market.json` and uses only
same-fingerprint minute data. Its timestamps are not refreshed or hidden. The
scheduled ten-minute reference cannot guarantee continuously fresh 1m bars;
85-second minute freshness still produces DATA HOLD between stale snapshots.
Publishing the updated hosted adapter enables its cached once-per-minute pulls
(the page polls every 15 seconds). Missing data is never synthesized.

## Confirmed minute capture

Both the Node TradingView adapter and the scheduled Python capture expose the
original confirmed 1m observations, with provider source identity matching 3m
and daily data. No yfinance substitution is used for this bundle. Provider delay
is subtracted before candle-completion checks. The public bundle contains up to
120 recent session minute bars per instrument; complete captured histories are
retained for research outside website assets. Indices retain null volume.

Each ticker has `one_minute_bars` and `one_minute_health`: timestamp, interval,
source fingerprint, bar count, contiguity and CURRENT/STALE/GAP/UNAVAILABLE/CLOSED.
Daily references and the frozen Saty baseline remain unchanged. All four
instruments (SPY, SPX, AAPL, GOOGL) share this path.

## Explicit public input sync

Local saves remain local. To sync:

1. Enter structured JSON using the EOD page templates, or add a publishable daily
   lesson paraphrase. Replace example values with actual observations.
2. Check the public-disclosure consent box, then **Prepare public sync**. This
   only constructs a preview; it sends nothing and stores no token.
3. Inspect the exact JSON. **Review and submit on GitHub** opens an issue with
   the payload. Submit as the repository owner. Its entire issue body is public.
4. **Sync public EOD inputs** validates the fields and commits accepted data to
   `dashboard-data/manual-inputs.json`. The Action status, not the preview, is
   confirmation of synchronization. A manual workflow-dispatch `payload` input
   supports larger submissions without using an issue-link query string.

Only owner-submitted `[SATY input sync]` issues are accepted automatically.
Workflow-dispatch requires repository write access. The receiver allows only
named contract, max-pain, GEX and lesson fields, rejects extra fields,
credential-like text, nonfinite numbers, future source times and non-0DTE
contracts, and deduplicates identical payloads. Public consent is mandatory.
No validator can make disclosure safe after a secret has already been posted:
review before submitting. Never paste credentials or private account records.

Immutable files in `state/inputs/<hash>.json` retain source time and server
receipt time. A late submission is never treated as information available
before an earlier signal. The latest observation per ticker and recent lessons
are in `manual-inputs.json`; the review reads the immutable originals.
Leaderboard premium vs VWAP is not a trader's known cost basis. Shakeout tags
remain manual hypotheses. No manual input changes weights or probabilities.

## WAIT ledger and observation coverage

Each shared capture runs the unchanged baseline over its actual bar prefixes
and calculates six directional row weights at each bar close. Ten-minute
features use only candles complete at that decision time. The collector appends
new rows to `state/decisions/YYYY-MM-DD.jsonl`, including:

- time, bar open, symbol, decision (CALL/PUT/WAIT), setup and reason;
- call/put/wait evidence weights, six row directions, ATR and close;
- source fingerprint, strategy version, first receipt time and receipt delay.

WAIT means no **new managed baseline entry** on that bar, not zero directional
support, no existing position, or a prediction that price stays flat.
`OBSERVED` requires first receipt within the existing 225-second 3m freshness
limit. `REPLAY_LATE` is a reconstruction from subsequently retrieved bars. The
first record is immutable; provider revisions are logged separately. Neither
category proves a hypothetical next-open fill was available.

Daily WAIT counts and rates use actual OBSERVED rows, never the last snapshot's
WAIT score. Replay counts have a separate denominator. An **observed all-day
WAIT** alarm requires every expected session bar to have an observed WAIT,
plus a range of at least 1 daily ATR. A complete historical replay with poor
observation coverage receives a differently named replay diagnostic. Ten-minute
scheduled capture alone normally cannot observe every 3m close within 225s.
Missing coverage is shown, not converted to certainty about a whole day.

Every observed WAIT is assessed against the next five available scheduled 3m
bars (or the remaining complete session). A >=0.25 daily-ATR excursion is
`MISSED_MOVE_CONTEXT`, not a loss or proof that WAIT was incorrect. Missing
outcome bars remain unresolved. Signal excursion dominance is also descriptive,
not first-touch probability or option P&L. Rates show hits, n and Wilson 95%
intervals; these intervals do not correct intraday/session dependence.

## Real challenger replay

An alarm queues a candidate. At most one active executable challenger is frozen
at a time; other candidates wait. Legacy text-only REGISTERED diagnostics are
not reported as backtested strategies. The first selected candidate gets a
machine-readable `rule_set` and a new registration timestamp. Only sessions
opening **after** that timestamp are eligible.

`atr_cross` evaluates fresh daily-ATR crossings with a selectable strict,
13/48-only (relaxed), or no ribbon confirmation. Parameters specify trigger
ATR, risk ATR, target R and bar horizon, with bounds and an exact rule hash.
The default hypothesis is a 0.236-ATR crossing, 13/48 confirmation, 0.15 daily
ATR risk, 1R target and five-bar horizon. These are research choices, not a
verified instruction from Saty. `baseline` replays the exact original entry
rules for diagnostic candidates; it does not loosen feed-quality gates.

For both baseline and challenger, the evaluation policy uses next-bar open,
one active episode at a time, gap-aware stop/target handling, conservative
stop-first intrabar ties, and a registered time cutoff. Returns are hypothetical
underlying R, not options returns. Adverse execution scenarios are $0, $0.02
and $0.05 per share per side, plus one extra 3m bar of entry delay. A full
recorded session is required. Unknown horizons are excluded with an explicit
count; timeouts are nonhits for target-before-stop frequency.

`state/shadow/<candidate>/<date>.json` preserves every alternate call and
outcome. `shadow-evidence.json` supplies actual hit/n, Wilson intervals, session
and episode counts, baseline comparison, paired session effects and costs.
No alternate call enters `market.json` signals or live evidence weights.

Thirty new complete sessions and 100 resolved nonoverlapping episodes only
permit review. Promotion still requires a preregistered minimum effect,
paired session-cluster inference, cost/delay and guardrail checks, a reviewed
versioned PR and rollback. No code here promotes rules automatically or claims
100 intraday episodes are independent observations.

## Context candidates

EOD-01 (1m pivot/phase divergence), EOD-02 (3m divergence), EOD-03 (range
compression and swing rejection), EOD-04 (manual leaderboard shakeout), and
EOD-05 (manual late max pain / negative gamma) are registered RESEARCH ideas.
They have no validated probability and contribute zero live evidence weight.

## Storage and scheduler

All three writing workflows share one concurrency group, `saty-dashboard-data`.
They restore the generated branch and use non-force pushes. Code-owned evidence,
learning summaries and the original `uw.json` are not overwritten by older
restored generated copies. The explicit sync file is separate.

The EOD Action runs at 21:10 UTC and verifies the New York exchange date and
close. It finalizes capture, reviews immutable observations, runs shadow replay,
and persists the results. Holidays and pre-close calls skip review. Full review
rows live under `state/reviews/`; the site gets the latest ten compact reviews.
Source artifacts remain buildless with no new production dependency. The budget
is 750 KB for four-ticker seed data plus 1m support; 1m histories and full ledgers
are not duplicated into the frontend. The seed predates minute capture and is
honestly missing it until the shared Action writes actual minute data.
