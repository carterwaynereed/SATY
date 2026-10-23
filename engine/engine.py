"""Saty signal engine (signal-only; no broker, no orders). Data: TradingView websocket (tvdata.py), yfinance fallback.
Replays today's completed 3m bars through the Saty v3 rule set (lib/strategy_po.StrategyPO with default args = v3:
trigger break, Golden Gate pullback, ribbon re-entry, squeeze breakout) plus context detectors (Golden Gate open,
ribbon flip). Deterministic replay each poll -> robust to data gaps/backfills."""
import os, sys, json, math, datetime as dt
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "lib"))
import pandas as pd
from strategy import wilder_atr
from strategy_v2 import LEVELS
from strategy_po import StrategyPO
EXT = {'+200': 2, '+161.8': 1.618, '+138.2': 1.382, '+123.6': 1.236, '-123.6': -1.236, '-138.2': -1.382, '-161.8': -1.618, '-200': -2}
TARGET_LEVELS = {**LEVELS, **EXT}   # strategy uses LEVELS internally; extensions only used as targets beyond +/-100%
ET = ZoneInfo("America/New_York")
WARM = 400; BAR = 3
SOURCE = {}

def now(): return dt.datetime.now(ET)

# ---------------- data
def _yf(sym, interval, period):
    import yfinance as yf
    d = yf.download(sym, period=period, interval=interval, progress=False, auto_adjust=False, prepost=False)
    if d is None or not len(d): raise RuntimeError(f"yfinance empty {sym} {interval}")
    d = d.droplevel(1, axis=1) if isinstance(d.columns, pd.MultiIndex) else d
    if interval != "1d": d.index = d.index.tz_convert(ET)
    else: d.index = pd.DatetimeIndex([pd.Timestamp(x.date(), tz=ET) + pd.Timedelta(hours=9, minutes=30) for x in d.index])
    return d[["Open", "High", "Low", "Close", "Volume"]].astype(float)

def daily(tv_sym="AMEX:SPY", yf_sym="SPY"):
    try:
        import tvdata; d = tvdata.get_bars(tv_sym, "D", 400); SOURCE["daily"] = f"TradingView {tv_sym} (Cboe One feed)"; return d
    except Exception as e:
        SOURCE["daily"] = f"yfinance {yf_sym} (TradingView failed: {e})"; return _yf(yf_sym, "1d", "2y")

def bars3(tv_sym="AMEX:SPY", yf_sym="SPY", n=1200):
    try:
        import tvdata; d = tvdata.get_bars(tv_sym, "3", n); SOURCE["intraday"] = f"TradingView {tv_sym} 3m (Cboe One feed)"; return d
    except Exception as e:
        m = _yf(yf_sym, "1m", "5d")
        d = m.resample("3min", origin="start_day", offset="30min").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}).dropna()
        SOURCE["intraday"] = f"yfinance {yf_sym} 1m->3m (TradingView failed: {e})"; return d

def bars1(tv_sym="AMEX:SPY", yf_sym="SPY", n=400):
    try:
        import tvdata; return tvdata.get_bars(tv_sym, "1", n)
    except Exception: return _yf(yf_sym, "1m", "1d")

def levels_for(d, day):
    """Saty ATR levels for `day` from daily bars strictly before it (prev close, Wilder ATR14)."""
    p = d[d.index.date < day]
    pc = float(p.Close.iloc[-1]); atr = wilder_atr(list(p.High), list(p.Low), list(p.Close))
    return pc, atr, {k: pc + f*atr for k, f in TARGET_LEVELS.items()}

# ---------------- indicators for display
def ema(series, n):
    return series.ewm(span=n, adjust=False).mean()

def phase_osc(df):
    """Saty Phase Oscillator: pivot=EMA21(close); raw=(close-pivot)/(3*ATR14 Wilder)*100; PO=EMA3(raw)."""
    c, h, l = df.Close, df.High, df.Low
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/14, adjust=False).mean()
    raw = (c - ema(c, 21)) / (3*atr) * 100
    return ema(raw, 3)

def po_zone(v):
    a = abs(v); s = "+" if v >= 0 else "-"
    if a >= 100: return f"extreme ({s}100)"
    if a >= 61.8: return "distribution (overbought)" if v > 0 else "accumulation (oversold)"
    if a >= 23.6: return "bullish phase" if v > 0 else "bearish phase"
    return "neutral (compression zone)"

def level_name(L, x):
    for k, v in L.items():
        if abs(v - x) < 1e-6: return k
    return None

def next_levels(L, side, px, atr, n=3):
    up = sorted(L.items(), key=lambda kv: kv[1])
    lv = [kv for kv in up if kv[1] > px + 0.05*atr] if side == 1 else [kv for kv in reversed(up) if kv[1] < px - 0.05*atr]
    return lv[:n]

# ---------------- replay
CTX_WIN = ("09:35", "15:30")
def replay(d3, Lfull, atr, day, upto=None):
    """Run rules over completed 3m bars of `day`. Returns (events, strat, today_df)."""
    L0 = {k: Lfull[k] for k in ('+100', '+61.8', '+38.2', '+23.6', '0', '-23.6', '-38.2', '-61.8', '-100')}
    s = StrategyPO(L0)
    prior = d3[d3.index.date < day].Close.iloc[-WARM:]
    for c in prior: s.warm(float(c))
    td = d3[d3.index.date == day]
    if upto is not None: td = td[td.index + pd.Timedelta(minutes=BAR) <= upto]
    ev = []; stack_prev = None; ggU = ggD = False; trigU = trigD = False
    for ts, r in td.iterrows():
        hm = ts.strftime("%H:%M"); o, h, l, c = float(r.Open), float(r.High), float(r.Low), float(r.Close)
        had = s.pos.copy() if s.pos else None
        sigs = s.on_bar(hm, o, h, l, c, True)
        t_close = ts + pd.Timedelta(minutes=BAR)
        for g in sigs:
            if g.kind.startswith("ENTER"):
                side = 1 if g.kind == "ENTER_LONG" else -1; p = s.pos
                ev.append(dict(kind="ENTRY", bar=hm, t=t_close, side=side, setup=g.reason, entry=c, stop=p["stop"], strat_t1=p["t1"], strat_t2=p["t2"]))
            else:
                ev.append(dict(kind="MGMT", bar=hm, t=t_close, side=had["side"] if had else 0, setup=(had or {}).get("setup_name", ""), action=g.kind, price=g.price, reason=g.reason))
        if s.pos and sigs and sigs[-1].kind.startswith("ENTER"): s.pos["setup_name"] = sigs[-1].reason
        e8, e21, e34 = s.e[8].v, s.e[21].v, s.e[34].v
        stack = 1 if e8 > e21 > e34 else (-1 if e8 < e21 < e34 else 0)
        inwin = CTX_WIN[0] <= hm < CTX_WIN[1]
        if inwin and stack_prev is not None and stack != 0 and stack != stack_prev:
            sw = td[td.index <= ts].iloc[-5:]
            stop = float(sw.Low.min()) if stack == 1 else float(sw.High.max())
            if stack*(c - stop) > 0:
                ev.append(dict(kind="ENTRY", bar=hm, t=t_close, side=stack, setup="ribbon flip", entry=c, stop=stop, context=True))
        stack_prev = stack
        # Golden Gate open (gate still open, i.e. 61.8 not already passed): first close beyond +/-38.2 today -> watch for 61.8; invalidation back through 23.6 trigger
        if inwin and not ggU and c > Lfull['+38.2'] and c < Lfull['+61.8'] - 0.05*atr:
            ggU = True; ev.append(dict(kind="ENTRY", bar=hm, t=t_close, side=1, setup="golden gate open", entry=c, stop=Lfull['+23.6'], fixed_targets=['+61.8', '+100'], context=True))
        if inwin and not ggD and c < Lfull['-38.2'] and c > Lfull['-61.8'] + 0.05*atr:
            ggD = True; ev.append(dict(kind="ENTRY", bar=hm, t=t_close, side=-1, setup="golden gate open", entry=c, stop=Lfull['-23.6'], fixed_targets=['-61.8', '-100'], context=True))
    for e in ev:
        if e["kind"] == "ENTRY":
            if e.get("fixed_targets"): e["targets"] = [(k, Lfull[k]) for k in e["fixed_targets"]]
            else: e["targets"] = next_levels(Lfull, e["side"], e["entry"], atr)
    return ev, s, td

def outcome(td_after, side, stop, targets):
    """Per target: 1 if touched before stop (stop touch checked first within a bar = conservative), else 0."""
    res = [None]*len(targets); stopped = False
    for _, r in td_after.iterrows():
        hit_stop = (r.Low <= stop) if side == 1 else (r.High >= stop)
        for i, (_, tv) in enumerate(targets):
            if res[i] is None:
                if hit_stop: res[i] = 0
                elif (r.High >= tv if side == 1 else r.Low <= tv): res[i] = 1
        if hit_stop: stopped = True; break
    return [0 if x is None else x for x in res], stopped

def is_session(t):
    return t.weekday() < 5 and dt.time(9, 30) <= t.time() < dt.time(16, 0)
