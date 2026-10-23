"""Shared state builder for snapshot.py and loop.py (saty-sig-2; signal-only, no broker, no orders)."""
import math, datetime as dt
import pandas as pd
import engine as E, sig2 as G, probs2 as P2, probs as PR1
def option_hint(side, px):
    k = math.floor(px) + 1 if side == 1 else math.ceil(px) - 1
    return f"INFORMATIONAL ONLY (not part of the probability): SPY 0DTE {'call' if side == 1 else 'put'} ~{k:.0f} strike (first OTM)"
def scalper_note(setup):
    w = PR1.trade_winrate(setup)
    if not w: return None
    m = PR1.load_pm(); p0 = m["pool"]["p"]
    return (f"old scalper backtest (managed P&L>0, Sep16-Oct13): observed {w['wins']}/{w['n']} = {100*w['wins']/w['n']:.0f}%; "
            f"smoothed {w['p']}% (prior {100*p0:.1f}% pooled, K=10) — different policy from the target probabilities")
def enrich(e, S, sym="SPY"):
    d = dict(time_et=e["decision_time"].strftime("%Y-%m-%d %H:%M ET"), bar_open=e["bar"], symbol=sym, kind=e["kind"], strategy_version=G.VERSION)
    if e["kind"] == "ENTRY":
        ref = e.get("entry", e["signal_close"])
        pr = P2.target_probs(S, e["setup"], e["cohort"], ref, e["stop"], e["targets"]) if e.get("status") != "cancelled_gap" else []
        d.update(direction="LONG" if e["side"] == 1 else "SHORT", setup=e["setup"], context_only=bool(e.get("context")), cohort=e["cohort"],
                 event_type=e.get("event_type"), why=e.get("why"), status=e.get("status"), signal_close=round(e["signal_close"], 2),
                 entry=round(ref, 2), entry_basis="next 3m open" if "entry" in e else "signal close (next open pending)",
                 stop=round(e["stop"], 2), risk_pts=round(abs(ref - e["stop"]), 2),
                 targets=[dict(name=k, level=round(v, 2), pts=round(abs(v - ref), 2)) for k, v in e["targets"]],
                 prob_target_before_stop=pr, outcomes_so_far=e.get("outcomes"), scalper_note=scalper_note(e["setup"]) if not e.get("context") else None,
                 option_hint=option_hint(e["side"], ref))
    else:
        d.update(direction="LONG" if e["side"] == 1 else "SHORT", setup=e.get("setup", ""), action=e["action"], price=round(e["price"], 2),
                 reason=e["reason"] + (" (v3 managed exit: close through 34 EMA / stop; NOT the fixed-stop used by the probabilities)" if e["reason"] == "stop" else ""))
    return d
def state(S=None, upto=None):
    S = S or P2.load(); t = upto or E.now(); day = t.date()
    dd = E.daily(); d3 = E.bars3(n=800)
    stale = None
    if len(d3) and (d3.index[-1].date() == day) and E.is_session(t) and (t - d3.index[-1]).total_seconds() > 7*60:
        stale = f"last 3m bar {d3.index[-1]:%H:%M} ET is stale"
    pc, atr, L = E.levels_for(dd, day)
    ev, strat, td, ind = G.replay(d3, L, atr, day, upto=t)
    tdall = d3[d3.index.date == day]          # includes the forming bar: gives the modeled entry (its open) as soon as it exists
    for e in ev:
        if e["kind"] == "ENTRY": G.evaluate(e, tdall, ind, complete=False)
    last = float(d3.Close.iloc[-1]) if len(d3) else None
    full = d3[d3.index.date <= day]
    em = {n: float(E.ema(full.Close, n).iloc[-1]) for n in (8, 13, 21, 34, 48)}
    po = E.phase_osc(full); pov = float(po.iloc[-1]); pop = float(po.iloc[-2])
    return dict(t=t, day=day, L=L, pc=pc, atr=atr, last=last, ev=ev, strat=strat, td=tdall, ema=em, po=pov, po_prev=pop,
                stale=stale, S=S, src=dict(E.SOURCE), squeeze=strat._squeeze(), sqn=strat.sqn, sqrng=strat.rng)
def po_text(v, rising):
    a = abs(v); d = "rising" if rising else "falling"
    if a >= 100: z = "extreme zone" + ("; momentum stretched" if (v > 0) == rising else "; extreme momentum waning")
    elif a >= 61.8: z = ("distribution zone" if v > 0 else "accumulation zone") + ("; downside momentum easing" if v < 0 and rising else "; upside momentum easing" if v > 0 and not rising else "")
    elif a >= 23.6: z = "bullish phase" if v > 0 else "bearish phase"
    else: z = "neutral band"
    return f"{v:+.1f}, {d} — {z}"
def ribbon_text(em, px):
    e8, e13, e21, e34, e48 = (em[n] for n in (8, 13, 21, 34, 48))
    st = "BULLISH (8>21>34)" if e8 > e21 > e34 else ("BEARISH (8<21<34)" if e8 < e21 < e34 else "MIXED / transitioning")
    conv = "13>48 bullish conviction" if e13 > e48 else "13<48 bearish conviction"
    pos = "above" if px > max(e8, e21, e34) else ("below" if px < min(e8, e21, e34) else "inside")
    return st, conv, pos
def render(X, sym="SPY", title="Saty signals"):
    L, px, atr = X["L"], X["last"], X["atr"]; S = X["S"]
    st, conv, pos = ribbon_text(X["ema"], px)
    lines = [f"# {title} — {sym} — {X['t']:%a %b %d %Y %H:%M:%S} ET ({G.VERSION})", "",
             "Signal-only (no broker, no orders). % = historical frequency of touching the target before the ORIGINAL stop by 16:00 ET, "
             "for this setup/cohort at this reward-to-risk; not a guarantee. b/e = break-even hit rate for that target vs the full stop.", "",
             f"Data: daily = {X['src'].get('daily')}; intraday = {X['src'].get('intraday')}" + (f"  **{X['stale']}**" if X['stale'] else ""), "",
             f"**Last {px:.2f}** | prev close {X['pc']:.2f} | ATR14 {atr:.2f} | day change {px - X['pc']:+.2f} ({100*(px - X['pc'])/atr:+.1f}% of ATR)", "",
             "## Saty ATR levels", "", "| level | price | dist |", "|---|---|---|"]
    shown = False
    for k, v in sorted(L.items(), key=lambda kv: -kv[1]):
        if abs(float(k.strip('+')) if k != '0' else 0) > 100 and abs(v - px) > 1.0*atr: continue
        if not shown and v < px: lines.append(f"| **price** | **{px:.2f}** | |"); shown = True
        lines.append(f"| {k}% | {v:.2f} | {v - px:+.2f} |")
    if not shown: lines.append(f"| **price** | **{px:.2f}** | |")
    e = X["ema"]
    lines += ["", "## Pivot Ribbon (3m EMAs, RTH closes)", "", f"8 {e[8]:.2f} | 13 {e[13]:.2f} | 21 {e[21]:.2f} | 34 {e[34]:.2f} | 48 {e[48]:.2f}",
              f"State: **{st}**, {conv}; price {pos} ribbon", "",
              f"## Phase Oscillator (3m): **{po_text(X['po'], X['po'] > X['po_prev'])}**", "",
              f"Custom squeeze filter (TTM + ribbon width ≤10th pct): {'ON for %d bars, range %.2f-%.2f' % (X['sqn'], X['sqrng'][1], X['sqrng'][0]) if X['squeeze'] and X['sqrng'] else 'off'}", ""]
    s = X["strat"]; lines.append("## Active setup (v3 managed position)")
    if s.pos:
        p = s.pos; lines.append(f"**{'LONG' if p['side'] == 1 else 'SHORT'} — {p.get('setup_name', '?')}** signal close {p['entry']:.2f}, managed stop {p['stop']:.2f}; strategy targets {p['t1']:.2f}/{p['t2']:.2f}; exits on 3m close through 34 EMA")
    else:
        lines.append("None open. Watching: long trigger > +23.6 %.2f, short trigger < -23.6 %.2f, GG up > %.2f, GG down < %.2f (configured bot windows 9:35-11:30 & 15:00-15:30 by bar open; squeeze 9:35-15:30)."
                     % (L['+23.6'], L['-23.6'], L['+38.2'], L['-38.2']))
    lines += ["", "## Today's signals (newest first; time = bar close / decision time)", ""]
    if not X["ev"]: lines.append("None yet.")
    for ev in reversed(X["ev"]):
        d = enrich(ev, S, sym)
        if d["kind"] == "ENTRY":
            tg = ", ".join(f"{t['name']} {t['level']}" for t in d["targets"])
            lines.append(f"- **{d['time_et'][11:]} {d['direction']} {d['setup']}** [{d['cohort']}; {d['event_type']}]{' (context)' if d['context_only'] else ''}: "
                         f"entry {d['entry']} ({d['entry_basis']}), stop {d['stop']} (risk {d['risk_pts']}), targets {tg}")
            lines.append(f"  - why: {d['why']}")
            if d["status"] == "cancelled_gap": lines.append("  - CANCELLED: next open already through stop/T1")
            else: lines.append(f"  - P(target before original stop): {P2.fmt(d['prob_target_before_stop'])}")
            if d.get("outcomes_so_far"): lines.append(f"  - so far: {', '.join(d['outcomes_so_far'])}")
            if d.get("scalper_note"): lines.append(f"  - {d['scalper_note']}")
            lines.append(f"  - {d['option_hint']}")
        else:
            lines.append(f"- {d['time_et'][11:]} {d['action']} {d['setup']} @ {d['price']} — {d['reason']}")
    if S:
        lines += ["", f"_Stats {S['version']}: {S['n_days']} sessions {S['days'][0]}..{S['days'][-1]}; {S['definition']}. "
                  f"Shrinkage K={P2.K:.0f} (cell → setup×RR-bucket → RR-bucket pool); no % when setup×bucket n<{P2.MIN_N}._"]
    return "\n".join(lines)
