# Market reader

Signal-only structure context. The reader scores a session against the daily ATR ladder (`0`, `23.6`, `38.2`, `50`, `61.8`, `78.6`, `100`) and returns a situation and a path. It does not place orders, invent candles, or promote a setup because a label fired.

Premarket and hourly extended-hours bars stay out of the read. Ribbon flips are context only. Most sessions sit.

## If-then reads

1. **Gap beyond 23.6, Golden Gate through 38.2, and the 10m or the trigger still holding** → morning bias with the gap. Choppy is allowed. A rising VIXY does not cancel this when absolute VIX is under 16. VIX confirms; it is not a solo veto. Unknown VIX neither confirms nor vetoes.
2. **Higher lows pressing an ATR lid, then the first ribbon hold** → first pullback only. An 8-EMA dip that holds the 21 before the 61.8 destination is continuation, not another entry.
3. **Dry volume while price boxes between two ATR levels** → sit. Flips inside the box are not a live signal.
4. **Another ribbon test after 100 is tagged, or after the 10m 21 is lost** → skip. Runners stop. That loss is not a reversal entry.

A+ context is the morning stack of 1 and 2. It is still not a live entry. The 10:30 grind lean is a forward test: the reader always logs it, and it stays watch-only.

Run a taped session with:

```sh
node scripts/read_market_structure.mjs market_reader/history/2026-10-26.json
```

## Daily note

On a weekday after the close, fetch Unusual Whales outside this repo (no API key is stored here), drop a Discord paraphrase into `market_reader/history/YYYY-MM-DD.json` when one exists, and run the reader. Record what worked, what failed, and what correctly sat. One challenger at a time, and only after a backfill of at least ten weeks. Ship to `main` when the reader or the scorecard actually changed. No challenger was opened for 26 Oct 2026.
