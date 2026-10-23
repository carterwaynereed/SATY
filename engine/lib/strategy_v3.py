"""v3 = v2 + squeeze/compression breakouts. Load: SCALPER_STRATEGY=strategy_v3:StrategyV3
Compression (on 3m bars): 'ribbon' = |e8-e34| width in lowest pct percentile of last 60 bars;
'ttm' = Bollinger(20,2) inside Keltner(20,1.5*ATR20); 'atr' = ATR5/ATR20 < atr_ratio; 'any'/'all' combine.
Squeeze must persist >= min_bars; enter on first close outside the squeeze range in break direction,
stop = other side of range, targets = next ATR levels (v2 partial logic)."""
import statistics as st
from strategy_v2 import StrategyV2
from strategy import Signal
# Defaults = walk-forward pick (tuned 9/16-9/29, OOS 9/30-10/13): TTM squeeze AND ribbon width <=10th pct, >=3 bars,
# trend filter e8>e21, squeeze allowed 09:35-15:30 (other setups keep v2 windows). See tests/bt_squeeze.py.
SQ = dict(sq=True, sq_mode='ttm+ribbon', sq_min_bars=3, sq_pct=10, atr_ratio=0.6, sq_trend=True,
          sq_windows=(('09:35','15:30'),), sq_only=False,
          itp=False, trail_trig=None, trail_dist=None, cat=None,
          mgmt=None, c_exit='ema8', c_partial=False,
          bilbo=False, bilbo_min=3, bilbo_max=5, bilbo_k=1.5, bilbo_only=False)
# bilbo: Saty 'Bilbo Box' - up to 5 compression candles (box height <= bilbo_k * 20-bar avg candle range); box = their hi/lo;
#  enter on close outside box in trend direction only (8>21>34 stacked), stop = opposite side of box, targets = next ATR levels.
# mgmt='carter': first-OTM strike; once SPY touches strike stop->strike (tick); runner exits per c_exit:
#  'ema8' 1m close vs 1m 8EMA, 'cross' 1m 8/21 cross, 'trail15'/'trail25' ATR trail from high-water; c_partial: half at first ATR level
# itp: instant take-profit on ticks (partial at first ATR target, rest at next). trail_trig/trail_dist (ATR units of SPY):
# once favorable excursion >= trail_trig, exit if price retraces trail_dist from best. cat: hard intrabar stop
# cat*ATR beyond the initial stop. Close-based stops and all entries remain bar-based.

class StrategyV3(StrategyV2):
    def __init__(s, levels, **kw):
        sq = {k: kw.pop(k) for k in list(kw) if k in SQ}
        q = {**SQ, **sq}; super().__init__(levels, **kw); s.q = q; s.p['itp'] = q['itp'] or q['mgmt'] == 'carter'
        from strategy import EMA as _E; s.m8 = _E(8); s.m21 = _E(21)
        s.bars = []; s.widths = []; s.trs = []; s.sqn = 0; s.rng = None; s.prevc = None; s.box = []
    def warm(s, c):
        super().warm(c); s._feed(c, c, c, c)
    def _feed(s, o, h, l, c):
        tr = h - l if s.prevc is None else max(h-l, abs(h-s.prevc), abs(l-s.prevc)); s.prevc = c
        s.bars.append((h, l, c)); s.trs.append(tr); s.bars = s.bars[-80:]; s.trs = s.trs[-80:]
        s.widths.append(abs(s.e[8].v - s.e[34].v) if s.e[8].v is not None else 0); s.widths = s.widths[-60:]
    def _squeeze(s):
        if len(s.bars) < 21: return False
        cl = [b[2] for b in s.bars[-20:]]; m = sum(cl)/20; sd = st.pstdev(cl); atr20 = sum(s.trs[-20:])/20
        ttm = atr20 > 0 and 2*sd < 1.5*atr20
        rib = len(s.widths) >= 30 and s.widths[-1] <= sorted(s.widths)[int(len(s.widths)*s.q['sq_pct']/100)]
        atr = atr20 > 0 and (sum(s.trs[-5:])/5)/atr20 < s.q['atr_ratio']
        md = s.q['sq_mode']
        return {'ttm': ttm, 'ribbon': rib, 'atr': atr, 'any': ttm or rib or atr, 'all': ttm and rib and atr,
                'ttm+ribbon': ttm and rib}[md]
    def on_bar(s, hm, o, h, l, c, can_enter=True):
        was, rng, n = s.sqn, s.rng, s.sqn
        if s.q['sq_only'] or s.q['bilbo_only']:
            saved = s.p['trigger'], s.p['gg'], s.p['reentry']; s.p['trigger'] = s.p['gg'] = s.p['reentry'] = False
        out = super().on_bar(hm, o, h, l, c, can_enter)
        if s.q['sq_only'] or s.q['bilbo_only']: s.p['trigger'], s.p['gg'], s.p['reentry'] = saved
        s._feed(o, h, l, c)
        sq_now = s._squeeze()
        # squeeze range tracked over prior squeeze bars (excluding current breakout bar)
        if out or s.pos or not s.q['sq'] or not can_enter or not any(a <= hm < b for a, b in s.q['sq_windows']):
            pass
        elif n >= s.q['sq_min_bars'] and rng:
            hi, lo = rng; e8, e21 = s.e[8].v, s.e[21].v
            if c > hi and (not s.q['sq_trend'] or e8 > e21):
                out = [s._open(1, c, lo, 'squeeze breakout')]
            elif c < lo and (not s.q['sq_trend'] or e8 < e21):
                out = [s._open(-1, c, hi, 'squeeze breakout')]
            if out: s.pos['ribbon_stop'] = False
        # ---- Bilbo box
        rng_avg = (sum(b[0]-b[1] for b in s.bars[-21:-1])/20) if len(s.bars) > 21 else None
        if s.q['bilbo'] and rng_avg and not out and not s.pos and can_enter and any(a <= hm < b for a, b in s.q['sq_windows']) and len(s.box) >= s.q['bilbo_min']:
            hi = max(b[0] for b in s.box); lo = min(b[1] for b in s.box); e8, e21, e34 = s.e[8].v, s.e[21].v, s.e[34].v
            if c > hi and e8 > e21 > e34: out = [s._open(1, c, lo, 'bilbo box')]; s.pos['ribbon_stop'] = False; s.box = []
            elif c < lo and e8 < e21 < e34: out = [s._open(-1, c, hi, 'bilbo box')]; s.pos['ribbon_stop'] = False; s.box = []
        cand = (s.box + [(h, l)])[-s.q['bilbo_max']:]
        if rng_avg and max(b[0] for b in cand) - min(b[1] for b in cand) <= s.q['bilbo_k'] * rng_avg: s.box = cand
        else: s.box = [(h, l)] if rng_avg and (h - l) <= s.q['bilbo_k'] * rng_avg else []
        if sq_now: s.sqn += 1; s.rng = (max(h, s.rng[0]), min(l, s.rng[1])) if s.rng and was else (h, l)
        else: s.sqn = 0; s.rng = None
        return out

    def strike_for(s, side, spot):
        import math
        return (math.floor(spot) + 1.0) if side == 1 else (math.ceil(spot) - 1.0)
    def on_minute(s, o, h, l, c):
        """1m close (live: built from ticks). Runner exits for mgmt='carter'."""
        e8, e21 = s.m8.update(c), s.m21.update(c); p = s.pos
        if not p or s.q['mgmt'] != 'carter' or not p.get('runner'): return []
        sd = p['side']; x = s.q['c_exit']
        if (x == 'ema8' and sd*(c - e8) < 0) or (x == 'cross' and sd*(e8 - e21) < 0):
            s.pos = None; return [Signal('EXIT', c, f'runner exit {x}')]
        return []
    def on_tick(s, px):
        """Called on every live price sample (2s). Returns [Signal] (TRIM/EXIT only; never entries)."""
        p = s.pos
        if not p: return []
        if s.q['mgmt'] == 'carter': return s._carter(px)
        sd = p['side']; a = s.atr; q = s.q; out = []
        if 'init_stop' not in p: p['init_stop'] = p['stop']; p['best'] = p['entry']
        if q['cat'] is not None and sd*(px - (p['init_stop'] - sd*q['cat']*a)) <= 0:
            s.pos = None; return [Signal('EXIT', p['init_stop'] - sd*q['cat']*a, 'catastrophic intrabar stop')]
        if q['trail_trig'] is not None and sd*(p['best'] - p['entry']) >= q['trail_trig']*a:
            if sd*(p['best'] - px) >= q['trail_dist']*a:
                s.pos = None; return [Signal('EXIT', p['best'] - sd*q['trail_dist']*a, 'trailing profit lock')]
        if sd*(px - p['best']) > 0: p['best'] = px
        if q['itp']:
            if not p['half'] and sd*(px - p['t1']) >= 0:
                p['half'] = True; p['stop'] = p['entry'] if sd*(p['entry']-p['stop']) > 0 else p['stop']
                out.append(Signal('TRIM' if p['t2'] != p['t1'] else 'EXIT', p['t1'], 'instant TP1'))
                if p['t2'] == p['t1']: s.pos = None; return out
            if p['half'] and sd*(px - p['t2']) >= 0:
                out.append(Signal('EXIT', p['t2'], 'instant TP2')); s.pos = None
        return out

    def _carter(s, px):
        p = s.pos; sd = p['side']; a = s.atr; q = s.q; out = []
        if 'K' not in p: p['K'] = s.strike_for(sd, p['entry']); p['best'] = p['entry']; p['init_stop'] = p['stop']
        if q['cat'] is not None and sd*(px - (p['init_stop'] - sd*q['cat']*a)) <= 0:
            s.pos = None; return [Signal('EXIT', p['init_stop'] - sd*q['cat']*a, 'catastrophic intrabar stop')]
        if p.get('runner'):
            if sd*(px - p['K']) <= 0: s.pos = None; return [Signal('EXIT', p['K'], 'strike stop')]
            if q['c_exit'].startswith('trail'):
                dist = {'trail15': .15, 'trail25': .25}[q['c_exit']] * a
                if sd*(p['best'] - px) >= dist: s.pos = None; return [Signal('EXIT', p['best'] - sd*dist, f"runner {q['c_exit']}")]
        if sd*(px - p['best']) > 0: p['best'] = px
        if not p.get('runner') and sd*(px - p['K']) >= 0:
            p['runner'] = True; p['stop'] = p['K']   # bar-close stop also at strike now
        if q['c_partial'] and not p['half'] and sd*(px - p['t1']) >= 0:
            p['half'] = True; out.append(Signal('TRIM', p['t1'], 'partial first ATR level'))
        return out
