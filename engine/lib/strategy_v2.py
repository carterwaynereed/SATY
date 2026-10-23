"""Saty v2 ('become Saty'): windows, Golden Gate pullbacks, trigger breaks, ribbon re-entries,
13/48 conviction filter, all ATR levels as targets, optional PM compression breakouts.
Same interface as strategy.Strategy. Load: SCALPER_STRATEGY=strategy_v2:StrategyV2
Sources: Saty Discord cheat sheet (windows 9:30-11:30 & 3-4, GG, 13/48), YouTube [A][B][C]."""
from strategy import EMA, Signal, FIBS as _F
LEVELS = {'+100':1,'+78.6':.786,'+61.8':.618,'+50':.5,'+38.2':.382,'+23.6':.236,'0':0,
          '-23.6':-.236,'-38.2':-.382,'-50':-.5,'-61.8':-.618,'-78.6':-.786,'-100':-1}
DEFAULTS = dict(windows=(('09:35','11:30'),('15:00','15:30')), trigger=True, gg=True, reentry=True,
                cross=True, compression=False, comp_bars=5, comp_width=0.06, targets='levels')

class StrategyV2:
    def __init__(s, levels, **kw):
        s.p = {**DEFAULTS, **kw}; s.L0 = levels
        pc = levels['0']; atr = levels['+100'] - pc; s.atr = atr
        s.L = {k: pc + f*atr for k, f in LEVELS.items()}
        s.up = sorted(s.L.values()); s.e = {n: EMA(n) for n in (8, 13, 21, 34, 48)}
        s.pos = None; s.armL = s.armS = True; s.ggU = s.ggD = False; s.hist = []
    def warm(s, c):
        for e in s.e.values(): e.update(c)
    def force_flat(s): s.pos = None
    def _inwin(s, hm): return any(a <= hm < b for a, b in s.p['windows'])
    def _tg(s, side, px, t1_default=None, t2_default=None):
        if s.p['targets'] == 'fib' and t1_default is None:
            t1_default, t2_default = (s.L['+38.2'], s.L['+61.8']) if side == 1 else (s.L['-38.2'], s.L['-61.8'])
        if s.p['targets'] == 'levels' or t1_default is None or side*(t1_default - px) <= 0.05*s.atr:
            lv = [x for x in s.up if x > px + 0.05*s.atr] if side == 1 else [x for x in reversed(s.up) if x < px - 0.05*s.atr]
            if len(lv) >= 2: return lv[0], lv[1]
            if lv: return lv[0], lv[0]
            return px + side*0.2*s.atr, px + side*0.3*s.atr
        return t1_default, t2_default
    def _open(s, side, c, stop, why, t1=None, t2=None):
        a, b = s._tg(side, c, t1, t2)
        s.pos = dict(side=side, entry=c, stop=stop, t1=a, t2=b, half=False, ribbon_stop=True)
        return Signal('ENTER_LONG' if side == 1 else 'ENTER_SHORT', c, why)
    def on_bar(s, hm, o, h, l, c, can_enter=True):
        e8, e13, e21, e34, e48 = (s.e[n].update(c) for n in (8, 13, 21, 34, 48))
        s.hist.append((h, l, abs(e8 - e34))); s.hist = s.hist[-20:]
        L = s.L; out = []; p = s.pos
        bull = e8 > e21 > e34; bear = e8 < e21 < e34
        if c > L['+38.2'] and bull: s.ggU = True
        if c < L['-38.2'] and bear: s.ggD = True
        if p:
            sd = p['side']
            if hm >= '15:48': s.pos = None; return [Signal('EXIT', c, 'time')]
            itp = s.p.get('itp')
            if not itp and not p['half'] and (h >= p['t1'] if sd == 1 else l <= p['t1']):
                p['half'] = True; p['stop'] = p['entry'] if sd*(p['entry']-p['stop']) > 0 else p['stop']
                out.append(Signal('TRIM', p['t1'], 'partial at ATR level'))
            if not itp and p['t2'] != p['t1'] and (h >= p['t2'] if sd == 1 else l <= p['t2']):
                out.append(Signal('EXIT', p['t2'], 'target level')); s.pos = None
            elif (c < p['stop'] or (p.get('ribbon_stop', True) and c < e34)) if sd == 1 else (c > p['stop'] or (p.get('ribbon_stop', True) and c > e34)):
                out.append(Signal('EXIT', c, 'stop')); s.pos = None
            elif not itp and p['half'] and p['t2'] == p['t1']:
                out.append(Signal('EXIT', c, 'single target')); s.pos = None
            return out
        if c < L['+23.6']: s.armL = True
        if c > L['-23.6']: s.armS = True
        if not can_enter or not s._inwin(hm): return out
        okL = bull and (not s.p['cross'] or e13 > e48); okS = bear and (not s.p['cross'] or e13 < e48)
        if s.p['trigger']:
            if s.armL and c > L['+23.6'] and okL and c > e8: s.armL = False; return [s._open(1, c, L['+23.6'], 'trigger break')]
            if s.armS and c < L['-23.6'] and okS and c < e8: s.armS = False; return [s._open(-1, c, L['-23.6'], 'trigger break')]
        touchL = l <= e8 and c > e21 and c > o; touchS = h >= e8 and c < e21 and c < o
        if s.p['gg']:
            if s.ggU and okL and touchL and c > L['+23.6']: return [s._open(1, c, e34, 'GG pullback to ribbon', L['+50'], L['+61.8'])]
            if s.ggD and okS and touchS and c < L['-23.6']: return [s._open(-1, c, e34, 'GG pullback to ribbon', L['-50'], L['-61.8'])]
        if s.p['reentry']:
            if okL and touchL and c > L['+23.6']: return [s._open(1, c, e34, 'ribbon re-entry')]
            if okS and touchS and c < L['-23.6']: return [s._open(-1, c, e34, 'ribbon re-entry')]
        if s.p['compression'] and hm >= '15:00' and len(s.hist) > s.p['comp_bars']:
            w = [x[2] for x in s.hist[-s.p['comp_bars']-1:-1]]; hi = max(x[0] for x in s.hist[-s.p['comp_bars']-1:-1]); lo = min(x[1] for x in s.hist[-s.p['comp_bars']-1:-1])
            if max(w) < s.p['comp_width']*s.atr:
                if c > hi and e8 > e21: return [s._open(1, c, lo, 'PM compression breakout', c+(hi-lo), c+2*(hi-lo))]
                if c < lo and e8 < e21: return [s._open(-1, c, hi, 'PM compression breakout', c-(hi-lo), c-2*(hi-lo))]
        return out
