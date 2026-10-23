"""TradingView chart websocket (no login, 'unauthorized_user_token'). Pure read-only market data.
get_bars(symbol, tf, n) -> pandas DataFrame indexed by ET timestamps, columns Open High Low Close Volume.
tf: '1','3','5','D' etc. Raises on failure (caller falls back to yfinance)."""
import json, random, string, re, asyncio, datetime as dt
import websockets, pandas as pd
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")
URL = "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart"
META = {}
def _rs(n=12): return ''.join(random.choice(string.ascii_lowercase) for _ in range(n))
def _pack(f, a): m = json.dumps({"m": f, "p": a}, separators=(',', ':')); return f"~m~{len(m)}~m~{m}"
def _frames(raw):
    out = []; i = 0
    while i < len(raw):
        m = re.match(r"~m~(\d+)~m~", raw[i:])
        if not m: break
        n = int(m.group(1)); s = i + m.end(); out.append(raw[s:s+n]); i = s + n
    return out
async def _get(symbol, tf, n, session, timeout):
    async with websockets.connect(URL, additional_headers={"Origin": "https://www.tradingview.com"},
                                  open_timeout=timeout, max_size=2**24) as ws:
        cs = "cs_" + _rs()
        sym = json.dumps({"symbol": symbol, "adjustment": "splits", "session": session})
        for f, a in [("set_auth_token", ["unauthorized_user_token"]), ("chart_create_session", [cs, ""]),
                     ("resolve_symbol", [cs, "sds_sym_1", "=" + sym]),
                     ("create_series", [cs, "sds_1", "s1", "sds_sym_1", tf, n, ""])]:
            await ws.send(_pack(f, a))
        bars = {}; meta = {}; done = False
        while not done:
            raw = await asyncio.wait_for(ws.recv(), timeout)
            for fr in _frames(raw):
                if fr.startswith("~h~"): await ws.send(_pack_h(fr)); continue
                try: j = json.loads(fr)
                except ValueError: continue
                m = j.get("m")
                if m == "symbol_resolved": meta = j["p"][2]
                elif m in ("timescale_update", "du"):
                    for v in j["p"][1].values():
                        if isinstance(v, dict):
                            for x in v.get("s", []): bars[x["v"][0]] = x["v"][1:6]
                elif m == "series_completed": done = True
                elif m in ("symbol_error", "series_error", "critical_error", "protocol_error"): raise RuntimeError(f"TV {m}: {j['p']}")
        META[symbol] = {k: meta.get(k) for k in ("pro_name", "source_id", "delay", "is_realtime", "data_status", "description")}
        return bars
def _pack_h(fr): return f"~m~{len(fr)}~m~{fr}"
def get_bars(symbol="AMEX:SPY", tf="1", n=500, session="regular", timeout=15):
    bars = asyncio.run(_get(symbol, tf, n, session, timeout))
    if not bars: raise RuntimeError("TV returned no bars")
    ts = sorted(bars)
    idx = pd.DatetimeIndex([dt.datetime.fromtimestamp(t, ET) for t in ts])
    df = pd.DataFrame([bars[t][:5] + [None]*(5-len(bars[t][:5])) for t in ts], index=idx, columns=["Open", "High", "Low", "Close", "Volume"]).astype(float)
    return df
if __name__ == "__main__":
    import sys
    for tf in sys.argv[1:] or ["1", "3", "D"]:
        d = get_bars("AMEX:SPY", tf, 300); print(tf, len(d), META.get("AMEX:SPY")); print(d.tail(3))
