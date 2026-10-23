"""STRATEGY INTERFACE (any class loaded via SCALPER_STRATEGY must provide):
  __init__(levels: dict)                      ATR levels from atr_levels()
  warm(close)                                 prior-day 3m closes for indicator warm-up
  on_bar(hm, o, h, l, c, can_enter) -> [Signal]   called on each completed 3m bar (hm = bar start 'HH:MM' ET)
      Signals: ENTER_LONG / ENTER_SHORT (must set self.pos = {stop, t1, t2, ...}), TRIM, EXIT
  force_flat()                                clear internal position (entry not filled / halted)
  pos                                         None or dict with at least 'stop','t1','t2'
No trade-count limit: re-entries allowed whenever the strategy re-arms.

Saty ATR Levels + Pivot Ribbon on 3m SPY bars (pure logic; same rules as /workspace/bt.py)."""
from dataclasses import dataclass, field
FIBS = {'+100':1,'+61.8':.618,'+38.2':.382,'+23.6':.236,'0':0,'-23.6':-.236,'-38.2':-.382,'-61.8':-.618,'-100':-1}

def atr_levels(prev_close, atr):
    return {k: prev_close + f*atr for k, f in FIBS.items()}

def wilder_atr(highs, lows, closes, n=14):
    trs = []
    for i in range(1, len(closes)):
        trs.append(max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])))
    a = trs[0]
    for tr in trs[1:]: a += (tr - a)/n
    return a

class EMA:
    def __init__(s, n): s.k = 2/(n+1); s.v = None
    def update(s, x): s.v = x if s.v is None else s.v + s.k*(x - s.v); return s.v

@dataclass
class Signal:
    kind: str            # ENTER_LONG, ENTER_SHORT, TRIM, EXIT
    price: float
    reason: str = ""

class Strategy:
    def __init__(s, levels):
        s.L = levels; s.e = {n: EMA(n) for n in (8, 21, 34)}
        s.pos = None      # dict(side, entry, stop, t1, t2, half)
        s.armL = s.armS = True
    def warm(s, close):
        for e in s.e.values(): e.update(close)
    def on_bar(s, hm, o, h, l, c, can_enter=True):
        """hm='HH:MM' bar start ET. Returns list of Signals."""
        e8, e21, e34 = (s.e[n].update(c) for n in (8, 21, 34))
        out = []; p = s.pos
        if p:
            sd = p['side']
            if hm >= '15:48': out.append(Signal('EXIT', c, 'time')); s.pos = None; return out
            if not p['half'] and (h >= p['t1'] if sd == 1 else l <= p['t1']):
                p['half'] = True; p['stop'] = p['entry']; out.append(Signal('TRIM', p['t1'], 'golden gate 38.2'))
            if (h >= p['t2'] if sd == 1 else l <= p['t2']):
                out.append(Signal('EXIT', p['t2'], 'target 61.8')); s.pos = None
            elif (c < p['stop'] or c < e34) if sd == 1 else (c > p['stop'] or c > e34):
                out.append(Signal('EXIT', c, 'stop: close through trigger/entry or 34ema')); s.pos = None
            return out
        if not can_enter or hm < '09:36' or hm >= '15:30': return out
        L = s.L
        if c < L['+23.6']: s.armL = True
        if c > L['-23.6']: s.armS = True
        if s.armL and c > L['+23.6'] and e8 > e21 > e34 and c > e8:
            s.pos = dict(side=1, entry=c, stop=L['+23.6'], t1=L['+38.2'], t2=L['+61.8'], half=False); s.armL = False
            out.append(Signal('ENTER_LONG', c, f"close>{L['+23.6']:.2f} bullish ribbon"))
        elif s.armS and c < L['-23.6'] and e8 < e21 < e34 and c < e8:
            s.pos = dict(side=-1, entry=c, stop=L['-23.6'], t1=L['-38.2'], t2=L['-61.8'], half=False); s.armS = False
            out.append(Signal('ENTER_SHORT', c, f"close<{L['-23.6']:.2f} bearish ribbon"))
        return out
    def force_flat(s): s.pos = None
