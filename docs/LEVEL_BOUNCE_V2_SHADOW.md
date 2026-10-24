# Level Bounce v2 — hidden shadow only

Live Level Bounce and its public UI, Worker, VIX transport, weights, stops and
signals are byte-for-byte unchanged. This isolated copy of v1 mechanics imports
only research filters; no live module imports v2. No orders, UI, public API
field, WAIT-ledger contribution or automatic promotion. Independent per-ticker
three-entry cap, one position, 30-minute cooldown after loss; same v1 fixed
0.35 ATR stop / 0.40 ATR target, VIX<20 put cap, 15:55 exact-minute exit, start,
cutoff, event/OPEX exclusions and conservative missing-data rules.

Additional entry filters, evaluated at the confirmation candle's close:
- Keep original intraday VIX versus completed-daily EMA21 gate.
- VIX key defaults to 16. Risk condition: current confirmed VIX **strictly above**
  key AND **at/above** latest confirmed native 5m EMA21. Calls blocked under
  that condition; puts require it. Missing 5m EMA means DATA HOLD.
- Puts blocked if latest confirmed native 1H close > EMA21 AND Phase >20.
  Phase is the existing frozen Saty proxy: EMA21 displacement / (3 × Wilder
  ATR14) ×100, smoothed EMA3. This is not a claim to reproduce proprietary code.
- Also block puts when current confirmed 3m close − PDC >0.5 daily ATR AND a
  strictly new session high was confirmed within the last 30 minutes inclusive.
  The opening candle establishes the first high; equal-high retests do not
  refresh the timestamp. No future bar participates.

Native 1H bars align at the exchange open (09:30 ET), with the last partial hour
confirmed at session close. Previous-session final hour applies before today's
first hour closes. At least 60 completed interval bars, contiguous recent warmup
and the latest expected completed bar are required. Missing 1H blocks puts only;
calls can still qualify. Source identities must match the RTH archived ticker
and 3m VIX feed. No fabricated hourly bars from short archives.

Daily keys in `learning/level-bounce-v2-shadow.json`:

```json
{"default_vix_key":16,"daily_keys":{"2026-10-26":{"key":17,"recorded_at":"2026-10-26T12:00:00Z"}}}
```

The example is documentation, not an active override. Overrides must be recorded
before exchange open. Malformed/late overrides hold the sample. The first review
freezes a session's key config in `state/level-bounce-v2/sessions/*-key.json`, so
subsequent config changes never rewrite a measured day's policy.

Existing intraday/EOD workflows add a bounded five-series capture (one VIX5,
four ticker1H) with concurrency three. Completed interval cache avoids redundant
hourly requests, no extra schedule, no closed-date capture. Inputs live only in
`state/level-bounce-v2/context/`; separate decisions, trades, gate audit, sample
sizes and Wilson intervals live under `state/level-bounce-v2/`. Observed versus
replay-late results require timely receipts from all used intervals. Only
post-registration sessions count; repeated reviews do not increase n. Source
failure is DATA HOLD, never an inferred pass. Existing event-calendar coverage
remains Oct–Dec 2026; v2 also holds outside it.

Reported five-week OOS: n=28, 75%, Wilson 57–87%, +4.48%, PF2.23, 5/5 weeks
positive. User-supplied, not independently reproduced: raw dates, trades, costs,
symbol weights and per-day historical key schedule were not supplied. Never
pooled with newly measured samples or shown as a live probability. The deployed
public bundle stays identical, and private paper journal is untouched.
