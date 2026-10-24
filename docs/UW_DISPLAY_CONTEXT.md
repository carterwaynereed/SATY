# Unusual Whales display context

The compact dashboard box is display-only. Its fields never influence momentum
eligibility, the daily signal budget, target outcomes, or research promotion.

`site/uw-view.mjs` exports `normalizeUW(raw, {symbol, now})`. It accepts the existing
single-symbol `uw.json` format or a `by_symbol` wrapper. It returns `values`,
per-field `fields` with source/time/scope/state, overall `state`, and missing/stale
field lists. Numeric prices retain their precision. Missing values are `null`,
not zero. Zero and negative net premium are valid.

Mappings:

| Display | Source |
| --- | --- |
| Call wall | `gamma.call_wall` |
| Put wall | `gamma.put_wall` |
| Gamma flip | `gamma.zero_gamma` (also explicit `gamma_flip` or `flip`) |
| Net premium | selected ticker's `flow.net_premium` |
| Max pain | selected ticker's `max_pain` number or `{spot}` |
| Market tide | root `market_tide`, explicitly market-wide |

Market tide may contain a supplied `summary` or the reported
`net_call_premium`/`net_put_premium` pair. The adapter describes the pair without
inventing a bullish/bearish classifier. ETF/ticker tide is not relabeled as
market-wide. SPY prices are never scaled or reused for SPX.

Every displayed observation requires a source and timestamp. A field can carry
its own metadata; otherwise it inherits its section and ticker metadata. Default
TTL is 15 minutes, with an absolute 60-minute ceiling on supplied TTL. Expired or
failed-refresh values remain dated references. A materially future timestamp,
unknown identity, missing metadata or placeholder produces unavailable data.

## Integration audit for the momentum redesign

The inspected SATY main `7c25ba5` and dashboard-data `95a90d4` both contained an
empty `uw.json` placeholder with `asof: null`; `manual-inputs.json` was empty.
The existing workflow did not fetch Unusual Whales data. It copied main's manual
file to dashboard-data. The hosted environment had no UW feed credential, and
the Sites eligibility-discovery operation was not exposed in this session.

An available ChatGPT Unusual Whales connection alone does not establish a hosted
Site connection. No user connector data was copied into public source as a
replacement for a live feed. The display therefore reports unavailable values
until a supported, timestamped payload is supplied. Existing connected payloads,
when supplied through the declared interface, retain their source and freshness.

The official Unusual Whales dashboard recipe recommends server-side credentials,
per-panel cached observations, and explicit timestamps. Market tide REST
documentation: https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.market_tide
