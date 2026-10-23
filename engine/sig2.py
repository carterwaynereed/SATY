"""saty-sig-2: causal event engine + barrier/managed outcome evaluation (signal-only; no broker, no orders).
Conventions (see audit_1.md):
- Decide after 3m bar t CLOSES (decision_time = bar_open + 3m); reference entry = OPEN of bar t+1.
- Daily reference (prev close, Wilder ATR14) from completed daily bars through D-1 only.
- Rule windows use bar OPEN time (first eligible bar 09:36-09:39, decision 09:39, entry 09:39 open).
- Every level event is classified: fresh_cross / recross / delayed_confirm / pre_window_cross / opening_gap, plus late flags.
- Targets frozen at decision (from signal close). Outcome evaluation starts at the entry bar (t+1)."""
import math, datetime as dt
import pandas as pd
import engine as E
from strategy_po import StrategyPO
VERSION = "saty-sig-2.0"
BAR = 3; CTX_WIN = ("09:35", "15:30"); SESSION_LAST = "15:57"
FRESH_DELAY_BARS = 3   # delayed_confirm counts as fresh if the level cross happened <= this many bars earlier (in window)

def warm_bar(s, o, h, l, c):
    """OHLC warm-up (baseline v1 warmed with closes only, which made PO/KC ATR close-to-close during warm-up)."""
    for e in s.e.values(): e.update(c)
    s._feed(o, h, l, c); s.po.update(h, l, c); s._agg(h, l, c)

def _beyond(x, lvl, side): return (x < lvl) if side == -1 else (x > lvl)

def classify_cross(td, i, lvl, side, win_start="09:35"):
    """How did close of bar i come to be beyond `lvl` (side=-1: below)? Uses bars 0..i only (causal)."""
    cl = td.Close.values[:i+1]; o0 = float(td.Open.iloc[0])
    beyond = [_beyond(c, lvl, side) for c in cl]
    ncross = sum(1 for k in range(len(beyond)) if beyond[k] and (k == 0 and not _beyond(o0, lvl, side) or k > 0 and not beyond[k-1]))
    j = max([k for k in range(i+1) if not beyond[k]], default=None)
    if j is None:
        if _beyond(o0, lvl, side): return "opening_gap", None, ncross
        cross_bar = 0
    else: cross_bar = j + 1
    since = i - cross_bar
    cross_hm = td.index[cross_bar].strftime("%H:%M")
    if since == 0: et = "recross" if ncross > 1 else "fresh_cross"
    elif cross_hm < win_start: et = "pre_window_cross"
    else: et = "delayed_confirm"
    return et, since, ncross

def next_levels(L, side, px, atr, n=3): return E.next_levels(L, side, px, atr, n)

def replay(d3, Lfull, atr, day, upto=None, warm=E.WARM):
    """Causal replay of `day` using only bars with close <= upto (if given). Returns (events, strat, td, ind)."""
    L0 = {k: Lfull[k] for k in ('+100', '+61.8', '+38.2', '+23.6', '0', '-23.6', '-38.2', '-61.8', '-100')}
    s = StrategyPO(L0)
    for _, r in d3[d3.index.date < day].iloc[-warm:].iterrows(): warm_bar(s, float(r.Open), float(r.High), float(r.Low), float(r.Close))
    td = d3[d3.index.date == day]
    if upto is not None: td = td[td.index + pd.Timedelta(minutes=BAR) <= upto]
    ev = []; ind = {}; stack_prev = None
    gg = {1: dict(attempt=0, armed=True), -1: dict(attempt=0, armed=True)}
    lo_run = hi_run = None
    for i, (ts, r) in enumerate(td.iterrows()):
        hm = ts.strftime("%H:%M"); o, h, l, c = (float(r[k]) for k in ("Open", "High", "Low", "Close"))
        lo_run = l if lo_run is None else min(lo_run, l); hi_run = h if hi_run is None else max(hi_run, h)
        had = s.pos.copy() if s.pos else None
        sigs = s.on_bar(hm, o, h, l, c, True)
        ind[ts] = dict(e8=s.e[8].v, e13=s.e[13].v, e21=s.e[21].v, e34=s.e[34].v, e48=s.e[48].v, po=s.po.v)
        dec = ts + pd.Timedelta(minutes=BAR)
        base = dict(bar_open=ts, decision_time=dec, bar=hm, i=i, signal_close=c, sess_low=lo_run, sess_high=hi_run)
        def reached618(side): return (lo_run <= Lfull['-61.8']) if side == -1 else (hi_run >= Lfull['+61.8'])
        for g in sigs:
            if g.kind.startswith("ENTER"):
                side = 1 if g.kind == "ENTER_LONG" else -1; p = s.pos; setup = g.reason
                e = dict(base, kind="ENTRY", side=side, setup=setup, stop=p["stop"], strat_t1=p["t1"], strat_t2=p["t2"],
                         ribbon_stop=p.get("ribbon_stop", True), managed=True)
                if setup == "trigger break":
                    lvl = Lfull['+23.6' if side == 1 else '-23.6']
                    et, since, nc = classify_cross(td, i, lvl, side)
                    e.update(event_type=et, bars_since_cross=since, crossings=nc, trigger_level=lvl)
                    late = reached618(side)
                    e["late"] = late
                    e["cohort"] = "fresh" if (et in ("fresh_cross", "recross") or (et == "delayed_confirm" and since <= FRESH_DELAY_BARS)) and not late else "late/gap"
                    e["why"] = f"close {c:.2f} {'>' if side == 1 else '<'} trigger {lvl:.2f}; {et}" + (f" ({since} bars after cross)" if since else "") + ("; GG destination 61.8 already reached" if late else "")
                elif setup == "GG pullback to ribbon":
                    dest = reached618(side)
                    e.update(event_type="gg_pullback", cohort="post-GG-dest" if dest else "pre-GG-dest", gg_dest_reached_before=dest,
                             why=f"pullback to 8 EMA held 21 after 38.2 break; 61.8 {'already' if dest else 'not yet'} reached")
                else:
                    e.update(event_type=setup.replace(" ", "_"), cohort="all", why=setup)
                ev.append(e)
            else:
                ev.append(dict(base, kind="MGMT", side=had["side"] if had else 0, setup=(had or {}).get("setup_name", ""), action=g.kind, price=g.price, reason=g.reason))
        if s.pos and sigs and sigs[-1].kind.startswith("ENTER"): s.pos["setup_name"] = sigs[-1].reason
        e8, e21, e34 = s.e[8].v, s.e[21].v, s.e[34].v
        stack = 1 if e8 > e21 > e34 else (-1 if e8 < e21 < e34 else 0)
        inwin = CTX_WIN[0] <= hm < CTX_WIN[1]
        if inwin and stack_prev is not None and stack != 0 and stack != stack_prev:
            sw = td.iloc[max(0, i-4):i+1]
            stop = float(sw.Low.min()) if stack == 1 else float(sw.High.max())
            if stack*(c - stop) > 0:
                ev.append(dict(base, kind="ENTRY", side=stack, setup="ribbon flip", stop=stop, context=True, managed=False,
                               event_type="ribbon_flip", cohort="all", why="8/21/34 newly stacked; stop = 5-bar swing"))
        stack_prev = stack
        # Golden Gate open: close beyond 38.2 while 61.8 NOT yet touched this session (through this bar). One episode per
        # direction; a new attempt is allowed only after reset (close back through the 23.6 trigger) and 61.8 still untouched.
        for side in (1, -1):
            gs = gg[side]; k38, k618, k236 = ('+38.2', '+61.8', '+23.6') if side == 1 else ('-38.2', '-61.8', '-23.6')
            if not gs["armed"] and not _beyond(c, Lfull[k236], side): gs["armed"] = True   # reset
            if inwin and gs["armed"] and _beyond(c, Lfull[k38], side) and not reached618(side) and side*(Lfull[k618] - c) > 0.05*atr:
                et, since, nc = classify_cross(td, i, Lfull[k38], side)
                gs["armed"] = False; gs["attempt"] += 1
                fresh = et in ("fresh_cross", "recross") or (et == "delayed_confirm" and since <= FRESH_DELAY_BARS)
                ev.append(dict(base, kind="ENTRY", side=side, setup="golden gate open", stop=Lfull[k236], fixed_targets=[k618, '+100' if side == 1 else '-100'],
                               context=True, managed=False, event_type=et, bars_since_cross=since, attempt=gs["attempt"],
                               cohort=("fresh" if fresh else "late/gap") if gs["attempt"] == 1 else "re-attempt",
                               why=f"close {c:.2f} beyond 38.2 {Lfull[k38]:.2f}, 61.8 untouched; {et}, attempt {gs['attempt']}"))
            elif gs["armed"] and inwin and _beyond(c, Lfull[k38], side) and reached618(side) and gs["attempt"] == 0:
                gs["armed"] = False; gs["attempt"] = -1   # destination already reached before any qualifying close -> no GG this session
    for e in ev:
        if e["kind"] != "ENTRY": continue
        e["targets"] = [(k, Lfull[k]) for k in e["fixed_targets"]] if e.get("fixed_targets") else next_levels(Lfull, e["side"], e["signal_close"], atr)
        e["daily_atr"] = atr
    return ev, s, td, ind

def resolve_1m(m1, ts, side, S, T):
    """Within 3m bar starting ts: which of stop/target came first on 1m bars? 'T','S','AMB' or None (no 1m data)."""
    if m1 is None: return None
    b = m1[(m1.index >= ts) & (m1.index < ts + pd.Timedelta(minutes=BAR))]
    if len(b) < 3: return None
    for _, r in b.iterrows():
        hs = (r.Low <= S) if side == 1 else (r.High >= S); ht = (r.High >= T) if side == 1 else (r.Low <= T)
        if hs and ht: return "AMB"
        if hs: return "S"
        if ht: return "T"
    return "AMB"

def barrier(after, side, Ent, S, targets, complete, m1=None, target_first=False):
    """Fixed original stop vs frozen targets, from the entry bar (entered at its open). Gap-aware on later bars' opens.
    Returns per target dict(outcome, time, amb) + stop exit price/time + timeout close."""
    res = [None]*len(targets); amb = [False]*len(targets); stop_px = None; stop_t = None
    for k, (ts, r) in enumerate(after.iterrows()):
        if k > 0:
            if side*(r.Open - S) <= 0:
                stop_px, stop_t = float(r.Open), ts
                break
            for j, (_, T) in enumerate(targets):
                if res[j] is None and side*(r.Open - T) >= 0: res[j] = ("TARGET_FIRST", ts)
        hs = (r.Low <= S) if side == 1 else (r.High >= S)
        for j, (_, T) in enumerate(targets):
            if res[j] is not None: continue
            ht = (r.High >= T) if side == 1 else (r.Low <= T)
            if ht and not hs: res[j] = ("TARGET_FIRST", ts)
            elif ht and hs:
                w = resolve_1m(m1, ts, side, S, T)
                if w == "T": res[j] = ("TARGET_FIRST", ts)
                elif w == "S": pass
                else:
                    amb[j] = True
                    if target_first: res[j] = ("TARGET_FIRST", ts)
        if hs: stop_px, stop_t = S, ts; break
    out = []
    for j in range(len(targets)):
        if res[j] is not None: out.append(dict(outcome=res[j][0], t=res[j][1], amb=amb[j]))
        elif stop_t is not None: out.append(dict(outcome="STOP_FIRST", t=stop_t, amb=amb[j]))
        else: out.append(dict(outcome="TIMEOUT" if complete else "UNKNOWN", t=None, amb=amb[j]))
    last_close = float(after.Close.iloc[-1]) if len(after) else Ent
    return out, stop_px, stop_t, last_close

def managed(after, ind, side, Ent, S, t1, t2, ribbon_stop):
    """v3 exit policy (the exit log): half at T1 & stop->entry, rest at T2, else exit on CLOSE through stop or 34 EMA, 15:48 time exit."""
    half = False; stop = S; risk = abs(Ent - S)
    for ts, r in after.iterrows():
        hm = ts.strftime("%H:%M")
        if hm >= "15:48": X = float(r.Close); why = "time"; break
        if not half and ((r.High >= t1) if side == 1 else (r.Low <= t1)):
            half = True; stop = Ent if side*(Ent - stop) > 0 else stop
        e34 = ind[ts]["e34"]
        if t2 != t1 and ((r.High >= t2) if side == 1 else (r.Low <= t2)): X = t2; why = "T2"; break
        if (r.Close < stop or (ribbon_stop and r.Close < e34)) if side == 1 else (r.Close > stop or (ribbon_stop and r.Close > e34)):
            X = float(r.Close); why = "stop/34EMA close"; break
        if half and t2 == t1: X = float(r.Close); why = "single target"; break
    else:
        X = float(after.Close.iloc[-1]) if len(after) else Ent; why = "eod"
    R = (0.5*side*(t1 - Ent) + 0.5*side*(X - Ent))/risk if half else side*(X - Ent)/risk
    return dict(R=R, exit=X, why=why, half=half)

def evaluate(e, td, ind, complete, m1=None):
    """Attach modeled entry (next open), cancellation, R geometry, fixed-barrier outcomes (stop-first & target-first) and realized R."""
    nxt = td[td.index >= e["decision_time"]]
    e["strategy_version"] = VERSION
    mins_left = (dt.datetime.combine(e["decision_time"].date(), dt.time(16, 0), e["decision_time"].tzinfo) - e["decision_time"]).total_seconds()/60
    e["minutes_remaining"] = round(mins_left)
    if not len(nxt): e["status"] = "pending_entry"; return e
    side = e["side"]; Ent = float(nxt.Open.iloc[0]); S = e["stop"]; e["entry_time"] = nxt.index[0]; e["entry"] = Ent
    T = e["targets"]
    if not T or side*(Ent - S) <= 0 or side*(T[0][1] - Ent) <= 0:
        e["status"] = "cancelled_gap"; e["cancel_reason"] = "next open already through stop" if side*(Ent - S) <= 0 else "next open already at/through T1"; return e
    e["status"] = "entered"; risk = abs(Ent - S); atr = e["daily_atr"]
    e["risk"] = risk; e["risk_atr"] = risk/atr
    e["target_R"] = [abs(t - Ent)/risk for _, t in T]; e["target_atr"] = [abs(t - Ent)/atr for _, t in T]
    if "trigger_level" in e: e["beyond_trigger_atr"] = side*(Ent - e["trigger_level"])/atr
    o_sf, sp, st, lc = barrier(nxt, side, Ent, S, T, complete, m1, target_first=False)
    o_tf, *_ = barrier(nxt, side, Ent, S, T, complete, m1, target_first=True)
    e["outcomes"] = [x["outcome"] for x in o_sf]; e["outcomes_tf"] = [x["outcome"] for x in o_tf]; e["amb"] = [x["amb"] for x in o_sf]
    e["timeout"] = any(x == "TIMEOUT" for x in e["outcomes"])
    # P1: fixed T1 vs original stop, else session-end close
    o1 = e["outcomes"][0]
    if o1 == "TARGET_FIRST": e["R_fixedT1"] = e["target_R"][0]
    elif o1 == "STOP_FIRST": e["R_fixedT1"] = side*((sp if sp is not None else S) - Ent)/risk
    elif o1 == "TIMEOUT": e["R_fixedT1"] = side*(lc - Ent)/risk
    else: e["R_fixedT1"] = None
    if e.get("managed") and complete:
        m = managed(nxt, ind, side, Ent, S, e["strat_t1"], e["strat_t2"], e.get("ribbon_stop", True))
        e["R_managed"] = m["R"]; e["managed_exit"] = m
    for k in ("R_fixedT1", "R_managed"):
        if e.get(k) is not None: e[k + "_atr"] = e[k]*risk/atr   # realized move in daily-ATR units (robust to tiny stops)
    e["tiny_risk"] = risk < 0.05*atr
    return e

def rr_bucket(r):
    return "<0.5R" if r < 0.5 else ("0.5-1R" if r < 1 else ("1-2R" if r < 2 else ("2-4R" if r < 4 else ">4R")))
