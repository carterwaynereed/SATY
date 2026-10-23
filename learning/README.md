# Learning without moving the goalposts

The production baseline is **`saty-sig-2.0`, RTH variant**. This folder records ideas and prospective evaluations. Appending a lesson does not change the engine, thresholds, probabilities, or dashboard ranking. No process in this repository automatically promotes a candidate or refits the supplied statistics.

## Files and record formats

| File | Purpose |
| --- | --- |
| `candidates.jsonl` | Append-only rule registry. The six supplied audit questions are seeded as `RESEARCH`, not active rules. |
| `challengers.jsonl` | Append-only evaluation and promotion-decision log. Empty until a real prospective comparison exists. |
| `templates/rule-candidate.json` | Complete candidate record to copy, fill and append as one JSON line. |
| `templates/challenger.json` | Frozen evaluation plan/results record. Unknown results remain `null`. |
| `templates/session.json` | Daily review record; save one completed JSON file under `sessions/YYYY-MM-DD.json`. |
| `candidate.schema.json`, `challenger.schema.json` | JSON Schema contracts for records. |

Use new records with a unique `record_id` and the same `candidate_id` when updating an existing idea. Preserve previous records. `supersedes_record_id` links a correction or new plan. Never edit a prior prediction to match a later outcome. A bug correction is a new data/version event with an audit trail.

## Each session

1. **Before the open:** record baseline strategy commit, evidence hash, provider, daily-bar reference date, warm-up completeness, calendar session hours, known source delays, and the prepared plan. Save the UW snapshot timestamp, symbol, units, expiry scope and method if manually entered; missing context remains missing.
2. **At each observation:** the runner logs its actual observation time separately from the engine's historical decision/entry timestamps. Preserve the first observed entry, stop, targets, probability evidence, source and data health. Distinguish a setup observed before its next-bar entry from one discovered after the entry had already occurred. A replay found ten minutes later is not an executable ten-minute-earlier forward forecast.
3. **After the close:** reconcile every candidate signal, including cancelled, filtered, late, losing and timeout cases. Record target-first/stop-first/timeout/unknown per original-stop target; managed exits are a separate outcome. Record ambiguity, missing bars, provider switches and any revisions. Preserve immutable first-observation records and append outcome updates separately.
4. **Review in session units:** count eligible and late signals, distinct sessions, overlapping episodes, risk in dollars/ATR, MFE/MAE when reconstructable, and time to each outcome. Compare calibration only for predictions whose evidence and inputs were available at their claimed decision time. Scheduled snapshots are initially an observation audit, not an automatic proof of tradable performance.
5. **Log the lesson:** write a concise paraphrase and source locator. Include the public video URL plus timestamp, or an authorized Discord message locator and capture time. Do not copy private messages, transcripts, membership-only charts, account details, authentication tokens or unlicensed data into this public repository. Keep private source material outside the public repository; a private reference ID and a paraphrase you may publish are sufficient.

A daily review may conclude **“no change.”** More observations make the record more useful; they do not justify changing parameters every day.

## Turn a lesson into one falsifiable rule

A lesson such as “avoid an exhausted Golden Gate” becomes a candidate like: “For a short GG open, reject a candidate when the session low had already touched the frozen −61.8% level before the decision bar.” Specify the data available at that moment, threshold, direction, session window, entry/exit policy, and what would falsify the claim. Link the rule to its source and separate the teacher's statement from our inference.

Register these fields **before** examining the evaluation interval:

- Baseline commit, candidate code commit, hypothesis and one exact rule difference.
- Instrument/feed/session basis, eligible sessions, required history, event/episode ID rule, overlap handling and source timestamps.
- Entry/stop/target/timeout definitions and the trading-cost stress assumptions, if measuring hypothetical returns.
- Primary metric, minimum worthwhile improvement, guardrail metrics and their acceptance bounds.
- Training dates, untouched test start/end or a predeclared stopping date, exclusion rules and the fixed review date.
- Session-cluster inference procedure, random seed, number of resamples, multiplicity handling and treatment of missing data.

Use a paired comparison across the same market sessions. For a policy-changing candidate, compare session-level outcomes over the full eligible session set, including zero-signal sessions. Do not restrict the baseline to the subset of trades the challenger happened to select. For probability calibration, compare predictions on the same eligible observations and report coverage separately.

## Promotion gates

`RESEARCH → REGISTERED → SHADOW → REVIEW → PROMOTED` requires an explicit reviewed code change. A candidate can also become `REJECTED` or `RETIRED`.

1. **Correctness first:** deterministic replay/prefix causality, completed-bar inputs, source parity, no future daily ATR, horizon definitions, and an honest missing-data path must pass. A critical correctness bug can be fixed immediately with a version change and invalidation of affected history; it is not a claimed performance improvement.
2. **Freeze the comparison:** register one primary hypothesis and a fixed review schedule before collecting the evaluation sample. A new threshold or target after looking at results starts a new candidate with new untouched data. Track the entire family of tried variants.
3. **Collect enough new evidence:** at least **30 new market sessions and 100 nonduplicated eligible episodes** is an initial review floor, not a proof of edge or a guaranteed adequate sample. Use a prospective power/precision target and require more data if uncertainty remains too wide. Correlated intraday signals are not 100 independent observations merely because there are 100 rows. The six seeded audit ideas have not passed this gate.
4. **Meet the preregistered decision rule:** for return policies, report paired session-level change, a session-cluster confidence interval, risk in both R and ATR units, and realistic cost/delay sensitivity. For probability changes, report paired Brier/log-loss improvement, calibration, coverage and uncertainty. Do not use a higher hit rate alone as the criterion.
5. **Verify stability:** require the predeclared guardrails to hold across ordinary source delays, relevant session windows, and planned stress assumptions. UW context only becomes a modeled input after prospective, timestamped collection and a separate registered test. Manually selected screenshots cannot be backfilled as if known live.
6. **Review and version:** Carter reviews the evidence and approves a concrete PR changing strategy/model version, documenting effective date, comparison report and rollback commit. Run only the accepted version in production. Preserve the challenger log and the frozen baseline for comparison.

No valid result is selected by repeatedly checking daily significance and stopping on a favorable day. If sequential analysis is desired, register its stopping/error-control rule first. A monitor can put the dashboard on DATA HOLD for missing or corrupt data immediately; it cannot silently replace the strategy with the day's best performer.

## Visible dashboard registry

Run `python scripts/summarize_learning.py` after editing the logs. The compact
`site/data/learning.json` is derived from their latest append-only records and
published to the shared `dashboard-data` branch on the next main-branch workflow.
Candidate-only log changes trigger that workflow, including outside market hours.
Both the hosted Saty+ home and the optional Pages mirror read the same JSON.

Only **one** challenger may have an active `REGISTERED`, `SHADOW` or `REVIEW`
record at a time. Retire or reject the existing challenger with a new linked
record before registering another. Updates must point `supersedes_record_id` to
the previous record for that candidate in the same log. A candidate must already
exist in the rule registry; active challengers require the complete frozen plan.
The summary generator rejects missing review metadata and below-floor promoted
records. It does not decide that a rule has scientific merit or change the engine.

The source fields displayed on the public dashboard contain publishable
paraphrases and locators only. Keep membership-only Discord text, private charts,
credentials and the desk's private paper journal out of these logs.

## Imported evidence

`stats/signal_stats_v2.json` remains the supplied 34-session development snapshot. The original ledger and raw frozen bars were not in the attachment, so the dashboard reconciles counts but does not claim to have independently reproduced the historical backtest. Post-hoc RR bucket choices, the RTH/ETH ribbon difference and pooled-target calibration diagnostics remain visible. Future forward evidence belongs in a separately versioned report; it must not overwrite this sample.
