"""v3 + Saty Phase Oscillator (PO) filters/exits. Load: SCALPER_STRATEGY=strategy_po:StrategyPO (+ SCALPER_STRATEGY_ARGS).
PO formula (Saty; satyland.com/phaseoscillator; ports of his open-source script on usethinkscript/prorealcode):
  pivot = EMA(close, 21); raw = (close - pivot) / (3 * ATR(14)) * 100; PO = EMA(raw, 3)
  Zones: +/-23.6 neutral, +/-61.8 distribution/accumulation, +/-100 extreme. ATR = Wilder (Pine ta.atr).
HTF context: PO on 9m bars (3 x 3m) as a stand-in for 10m (3m bars don't tile 10m)."""
from strategy import EMA, Signal
from strategy_v3 import StrategyV3
POD = dict(po_filter=False, po_htf=False, po_exit=None, po_div=False, po_trigger=False, po_max=100.0)
class PO:
    def __init__(s): s.piv = EMA(21); s.sm = EMA(3); s.atr = None; s.pc = None; s.n = 0; s.v = None; s.prev = None
    def update(s, h, l, c):
        tr = h - l if s.pc is None else max(h - l, abs(h - s.pc), abs(l - s.pc)); s.pc = c; s.n += 1
        s.atr = tr if s.atr is None else s.atr + (tr - s.atr)/14
        p = s.piv.update(c); s.prev = s.v
        s.v = s.sm.update((c - p)/(3*s.atr)*100) if s.atr > 0 else 0.0
        return s.v
class StrategyPO(StrategyV3):
    def __init__(s, levels, **kw):
        po = {k: kw.pop(k) for k in list(kw) if k in POD}; super().__init__(levels, **kw); s.o = {**POD, **po}
        s.po = PO(); s.htf = PO(); s.agg = []; s.ext = 0; s.hist = []   # (high, low, po) for divergence
    def warm(s, c):
        super().warm(c); s.po.update(c, c, c); s._agg(c, c, c)
    def _agg(s, h, l, c):
        s.agg.append((h, l, c))
        if len(s.agg) == 3: s.htf.update(max(a[0] for a in s.agg), min(a[1] for a in s.agg), c); s.agg = []
    def on_bar(s, hm, o, h, l, c, can_enter=True):
        v = s.po.update(h, l, c); s._agg(h, l, c); pv = s.po.prev if s.po.prev is not None else v
        had = s.pos is not None
        out = super().on_bar(hm, o, h, l, c, can_enter)
        O = s.o; hv = s.htf.v or 0.0
        # --- entry filter
        if out and out[0].kind.startswith("ENTER") and (O['po_filter'] or O['po_htf']):
            sd = 1 if out[0].kind == "ENTER_LONG" else -1
            ok = True
            if O['po_filter']: ok = sd*v > 0 and sd*(v - pv) > 0 and sd*v < O['po_max']
            if O['po_htf']: ok = ok and sd*hv > 0
            if not ok: s.pos = None; out = []
        # --- PO extreme trigger entries (third-party PO>+100 idea, mirror for shorts), trend-aligned, normal v3 windows
        if O['po_trigger'] and not out and not s.pos and can_enter and s._inwin(hm):
            e8, e21, e34 = s.e[8].v, s.e[21].v, s.e[34].v
            if v > 100 and pv <= 100 and e8 > e21 > e34: out = [s._open(1, c, e34, 'PO extreme break')]
            elif v < -100 and pv >= -100 and e8 < e21 < e34: out = [s._open(-1, c, e34, 'PO extreme break')]
        # --- exits on PO for positions held from before this bar
        if s.pos and had and not out:
            sd = s.pos['side']
            ex = None
            if O['po_exit'] == 'leave_extreme' and sd*pv >= 100 and sd*v < 100: ex = 'PO left extreme'
            elif O['po_exit'] == 'at_extreme' and sd*v >= 100: ex = 'PO reached extreme'
            elif O['po_exit'] == 'cross0' and sd*v < 0: ex = 'PO crossed 0'
            if O['po_div'] and not ex and len(s.hist) >= 10:
                prev = s.hist[-20:-3]
                if prev:
                    if sd == 1:
                        ph = max(prev, key=lambda x: x[0])
                        if h > ph[0] and v < ph[2] and ph[2] > 61.8: ex = 'PO bearish divergence'
                    else:
                        pl = min(prev, key=lambda x: x[1])
                        if l < pl[1] and v > pl[2] and pl[2] < -61.8: ex = 'PO bullish divergence'
            if ex: s.pos = None; out = out + [Signal('EXIT', c, ex)]
        s.hist.append((h, l, v)); s.hist = s.hist[-40:]
        return out
