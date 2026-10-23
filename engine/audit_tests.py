"""Causality (truncated replay), warm-up stability and indicator-parity checks for saty-sig-2. Writes stats/audit_tests.json."""
import json, os, datetime as dt, numpy as np, pandas as pd
import engine as E, sig2 as G, build_stats2 as B
dd, d3, m1, src = B.load_frozen()
days = B.sessions(d3, E.now().date())
CHK = [days[i] for i in (3, 10, 17, 24, 31)]; CUT = ["10:00", "11:15", "13:00", "15:15"]
sig = lambda e: (e["kind"], e.get("setup"), e["side"], e["bar"], round(e.get("stop", e.get("price", 0)), 4), e.get("cohort"), e.get("event_type"),
                 tuple((k, round(v, 4)) for k, v in e.get("targets", [])))
out = {}
# 1) truncated replay: physically drop all bars after the cutoff and compare with the full-day replay
mism = []; checks = 0
for day in CHK:
    pc, atr, L = E.levels_for(dd, day); evF, sF, tdF, indF = G.replay(d3, L, atr, day)
    for c in CUT:
        cut = pd.Timestamp(f"{day} {c}", tz=E.ET)
        d3t = d3[d3.index + pd.Timedelta(minutes=3) <= cut]
        evT, sT, tdT, indT = G.replay(d3t, L, atr, day)
        a = [sig(e) for e in evF if e["decision_time"] <= cut]; b = [sig(e) for e in evT]
        last = tdT.index[-1]; di = max(abs(indF[last][k] - indT[last][k]) for k in indT[last])
        checks += 1
        if a != b or di > 1e-9: mism.append(dict(day=str(day), cut=c, full=len(a), trunc=len(b), ind_diff=di))
out["truncation"] = dict(cutoffs=checks, mismatches=mism)
# 2) warm-up stability: 400 vs 1200 prior bars
wd = []; evd = 0; tot = 0
for day in days[8:]:
    pc, atr, L = E.levels_for(dd, day)
    e1, _, td, i1 = G.replay(d3, L, atr, day, warm=400); e2, _, _, i2 = G.replay(d3, L, atr, day, warm=1200)
    tot += len(e1); evd += sum(1 for x, y in zip(map(sig, e1), map(sig, e2)) if x != y) + abs(len(e1) - len(e2))
    for ts in td.index: wd.append(max(abs(i1[ts][k] - i2[ts][k]) for k in ("e8", "e13", "e21", "e34", "e48")) )
    wd_po = max(abs(i1[ts]["po"] - i2[ts]["po"]) for ts in td.index)
out["warmup"] = dict(sessions=len(days) - 8, events=tot, event_diffs=evd, max_ema_diff=max(wd), max_po_diff_last_session=wd_po)
# 3) Phase Oscillator parity: Pine form (EMA21 pivot, ta.atr(14)=RMA seeded by SMA, EMA3) over full history vs bot (OHLC warm) vs baseline v1 (close-only warm)
c, h, l = d3.Close, d3.High, d3.Low
tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1); tr.iloc[0] = h.iloc[0] - l.iloc[0]
rma = tr.copy() * np.nan; rma.iloc[13] = tr.iloc[:14].mean()
for i in range(14, len(tr)): rma.iloc[i] = (rma.iloc[i-1]*13 + tr.iloc[i])/14
po_pine = ((c - c.ewm(span=21, adjust=False).mean())/(3*rma)*100).ewm(span=3, adjust=False).mean()
from strategy_po import StrategyPO
rows = []
for day in CHK:
    pc, atr, L = E.levels_for(dd, day); _, _, td, ind = G.replay(d3, L, atr, day)
    # baseline v1 warm (closes only)
    L0 = {k: L[k] for k in ('+100', '+61.8', '+38.2', '+23.6', '0', '-23.6', '-38.2', '-61.8', '-100')}; s = StrategyPO(L0)
    for x in d3[d3.index.date < day].Close.iloc[-400:]: s.warm(float(x))
    old = {}
    for ts, r in td.iterrows(): s.on_bar(ts.strftime("%H:%M"), r.Open, r.High, r.Low, r.Close, True); old[ts] = s.po.v
    for hm in ("09:30", "09:45", "12:00", "15:00"):
        ts = pd.Timestamp(f"{day} {hm}", tz=E.ET)
        if ts in ind: rows.append(dict(t=f"{day} {hm}", pine=round(po_pine[ts], 3), v2=round(ind[ts]["po"], 3), v1=round(old[ts], 3)))
out["po_parity"] = dict(n=len(rows), max_abs_v2=max(abs(r["pine"] - r["v2"]) for r in rows), max_abs_v1=max(abs(r["pine"] - r["v1"]) for r in rows), rows=rows)
# EMA parity vs full-history ewm (Pine ta.ema seed differences vanish)
emd = []
for day in CHK:
    pc, atr, L = E.levels_for(dd, day); _, _, td, ind = G.replay(d3, L, atr, day)
    for n in (8, 13, 21, 34, 48):
        f = c.ewm(span=n, adjust=False).mean(); emd.append(max(abs(f[ts] - ind[ts][f"e{n}"]) for ts in td.index))
out["ema_parity_max_abs"] = max(emd)
# 4) Saty Pivot Ribbon computes conviction 13/48 on the EXTENDED-session close; bot uses RTH closes. Disagreement on RTH bars:
x = pd.read_csv(os.path.join(E.HERE, "baseline_v1/data/spy_3m_eth.csv"), index_col=0); x.index = pd.to_datetime(x.index, utc=True).tz_convert(E.ET)
xe13, xe48 = x.Close.ewm(span=13, adjust=False).mean(), x.Close.ewm(span=48, adjust=False).mean()
xe8, xe21, xe34 = (x.Close.ewm(span=n, adjust=False).mean() for n in (8, 21, 34))
r13, r48 = c.ewm(span=13, adjust=False).mean(), c.ewm(span=48, adjust=False).mean(); r8, r21, r34 = (c.ewm(span=n, adjust=False).mean() for n in (8, 21, 34))
idx = [t for t in d3.index if t.date() >= dt.date(2026, 10, 1) and t in x.index]
dis = sum((xe13[t] >= xe48[t]) != (r13[t] >= r48[t]) for t in idx)
stk = lambda a, b, cc, t: 1 if a[t] > b[t] > cc[t] else (-1 if a[t] < b[t] < cc[t] else 0)
dis2 = sum(stk(xe8, xe21, xe34, t) != stk(r8, r21, r34, t) for t in idx)
first = [t for t in idx if t.strftime("%H:%M") < "10:30"]
dis_am = sum((xe13[t] >= xe48[t]) != (r13[t] >= r48[t]) for t in first)
out["conviction_eth_vs_rth"] = dict(rth_bars=len(idx), conviction_sign_disagree=dis, pct=round(100*dis/len(idx), 1), before_1030_disagree=dis_am, before_1030_bars=len(first),
                                    ribbon_stack_disagree_if_chart_eth=dis2, pct_stack=round(100*dis2/len(idx), 1))
json.dump(out, open(os.path.join(E.HERE, "stats", "audit_tests.json"), "w"), indent=1, default=str)
print(json.dumps({k: (v if k != "po_parity" else {kk: vv for kk, vv in v.items() if kk != "rows"}) for k, v in out.items()}, indent=1, default=str))
print(out["po_parity"]["rows"][:6])
