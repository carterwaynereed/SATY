"""Rebuild saty-sig-2 statistics + event ledger + diagnostics.  /workspace/v/bin/python build_stats2.py [--frozen]
--frozen: use baseline_v1/data/*.csv (reproducible); default: live TradingView fetch."""
import sys, os, json, math, random, statistics as st, collections, datetime as dt
import pandas as pd
import engine as E, sig2 as G, probs2 as P2
OUT = os.path.join(E.HERE, "stats", "signal_stats_v2.json"); LEDGER = os.path.join(E.HERE, "stats", "ledger_v2.csv")
def load_frozen():
    f = lambda n: (lambda d: d.set_index(pd.to_datetime(d.index, utc=True).tz_convert(E.ET)))(pd.read_csv(os.path.join(E.HERE, "baseline_v1", "data", n), index_col=0))
    return f("spy_D.csv"), f("spy_3m_rth.csv"), f("spy_1m_rth.csv"), "frozen baseline_v1/data (TradingView AMEX:SPY, Cboe One)"
def load_live():
    import tvdata
    return E.daily(), E.bars3(n=20000), tvdata.get_bars("AMEX:SPY", "1", 20000), f"live {E.SOURCE}"
def sessions(d3, upto_day):
    days = [x for x in sorted(set(d3.index.date)) if x < upto_day and (d3.index.date == x).sum() >= 130]
    return [x for x in days if len(d3[d3.index.date < x]) >= E.WARM]
def run_day(dd, d3, m1, day):
    pc, atr, L = E.levels_for(dd, day)
    ev, s, td, ind = G.replay(d3, L, atr, day)
    complete = td.index[-1].strftime("%H:%M") == G.SESSION_LAST
    m1d = m1[m1.index.date == day] if m1 is not None and (m1.index.date == day).any() else None
    out = []
    for e in ev:
        if e["kind"] != "ENTRY": continue
        e = G.evaluate(e, td, ind, complete, m1d); e["session_date"] = str(day); e["daily_ref_date"] = str(dd[dd.index.date < day].index[-1].date()); out.append(e)
    return out
def obs_of(events):
    o = []
    for e in events:
        if e.get("status") != "entered": continue
        for j, oc in enumerate(e["outcomes"]):
            if oc == "UNKNOWN": continue
            o.append(dict(setup=e["setup"], cohort=e["cohort"], j=j, b=G.rr_bucket(e["target_R"][j]), r=e["target_R"][j], y=int(oc == "TARGET_FIRST"),
                          y_tf=int(e["outcomes_tf"][j] == "TARGET_FIRST"), amb=int(e["amb"][j]), to=int(oc == "TIMEOUT"), day=e["session_date"]))
    return o
def old_predict(train, o):
    """baseline-v1 style: setup x target-index frequency shrunk (K=10) toward pooled target-index rate."""
    pj = [x for x in train if x["j"] == o["j"]]; p0 = sum(x["y"] for x in pj)/len(pj) if pj else .5
    c = [x for x in pj if x["setup"] == o["setup"]]
    return (sum(x["y"] for x in c) + 10*p0)/(len(c) + 10), p0
def boot(days, fn, B=2000, seed=42):
    rnd = random.Random(seed); vals = []
    for _ in range(B):
        smp = [rnd.choice(days) for _ in days]; v = fn(smp)
        if v is not None: vals.append(v)
    if not vals: return (None, None)
    vals.sort(); return (vals[int(.025*len(vals))], vals[int(.975*len(vals)) - 1])
def main():
    frozen = "--frozen" in sys.argv
    dd, d3, m1, src = load_frozen() if frozen else load_live()
    today = E.now().date(); days = sessions(d3, today)
    events = []
    for day in days: events += run_day(dd, d3, m1, day)
    obs = obs_of(events)
    # ---- summary by setup x cohort
    by = collections.defaultdict(list)
    for e in events: by[(e["setup"], e["cohort"])].append(e)
    summ = {}
    for (su, co), es in sorted(by.items()):
        ent = [e for e in es if e["status"] == "entered"]; canc = len(es) - len(ent)
        sess = sorted({e["session_date"] for e in es})
        t1 = [e for e in ent if e["outcomes"][0] != "UNKNOWN"]
        h = sum(e["outcomes"][0] == "TARGET_FIRST" for e in t1); n = len(t1)
        htf = sum(e["outcomes_tf"][0] == "TARGET_FIRST" for e in t1)
        to = sum(e["outcomes"][0] == "TIMEOUT" for e in t1); amb = sum(e["amb"][0] for e in t1)
        R1 = [e["R_fixedT1"] for e in t1]; Rm = [e["R_managed"] for e in ent if e.get("R_managed") is not None]
        bd = collections.defaultdict(list)
        for e in t1: bd[e["session_date"]].append(e)
        dl = list(bd)
        rate = lambda smp: (lambda xs: sum(e["outcomes"][0] == "TARGET_FIRST" for e in xs)/len(xs) if xs else None)([e for d in smp for e in bd[d]])
        meanR = lambda smp, k: (lambda xs: sum(xs)/len(xs) if xs else None)([e[k] for d in smp for e in bd[d] if e.get(k) is not None])
        summ[f"{su} | {co}"] = dict(events=len(es), entered=len(ent), cancelled=canc, sessions=len(sess), t1_h=h, t1_n=n, t1_raw=h/n if n else None,
            t1_wilson=P2.wilson(h, n), t1_boot=boot(dl, rate) if dl else None, t1_targetfirst_amb=htf/n if n else None, timeouts=to, ambiguous=amb,
            med_T1_R=st.median(e["target_R"][0] for e in t1) if t1 else None,
            R_fixedT1_mean=st.mean(R1) if R1 else None, R_fixedT1_median=st.median(R1) if R1 else None, R_fixedT1_boot=boot(dl, lambda s: meanR(s, "R_fixedT1")) if dl else None,
            R_fixedT1_per_session=sum(R1)/len(days) if R1 else None,
            tiny_risk=sum(e["tiny_risk"] for e in ent), med_risk_atr=st.median(e["risk_atr"] for e in ent) if ent else None,
            R_fixedT1_atr_mean=st.mean(e["R_fixedT1_atr"] for e in t1) if t1 else None, R_fixedT1_atr_boot=boot(dl, lambda s: meanR(s, "R_fixedT1_atr")) if dl else None,
            R_managed_median=st.median(Rm) if Rm else None, R_managed_atr_mean=st.mean(e["R_managed_atr"] for e in ent if e.get("R_managed_atr") is not None) if Rm else None,
            R_managed_atr_boot=boot(dl, lambda s: meanR(s, "R_managed_atr")) if Rm else None,
            R_managed_mean=st.mean(Rm) if Rm else None, R_managed_n=len(Rm), R_managed_boot=boot(dl, lambda s: meanR(s, "R_managed")) if Rm else None)
    # ---- RR buckets (all targets)
    bk = collections.defaultdict(lambda: [0, 0])
    for o in obs: bk[o["b"]][0] += o["y"]; bk[o["b"]][1] += 1
    bsum = {b: dict(h=v[0], n=v[1], raw=v[0]/v[1], wilson=P2.wilson(*v), be_range={"<0.5R": ">67%", "0.5-1R": "50-67%", "1-2R": "33-50%", "2-4R": "20-33%", ">4R": "<20%"}[b]) for b, v in sorted(bk.items())}
    # ---- expanding-window forecasts (only sessions strictly before) + fixed folds
    dorder = [str(d) for d in days]; fc = {}
    for i, d in enumerate(dorder):
        if i < 10: continue
        tr = [o for o in obs if o["day"] < d]; T = P2.tables(tr)
        for idx, o in enumerate(obs):
            if o["day"] == d:
                pr = P2.predict(T, o["setup"], o["cohort"], o["r"]); po, p0 = old_predict(tr, o)
                fc[idx] = dict(new=pr["p"], old=po, base=p0, cutoff=dorder[i-1])
    def brier(idxs, key):
        xs = [(fc[i][key], obs[i]["y"]) for i in idxs if fc.get(i) and fc[i][key] is not None]
        return (round(sum((p - y)**2 for p, y in xs)/len(xs), 4), len(xs)) if xs else (None, 0)
    folds = []
    for a, b in ((20, 25), (25, 30), (30, len(dorder))):
        if len(dorder) <= a: continue
        trd, ted = dorder[:a], dorder[a:b]; tr = [o for o in obs if o["day"] in trd]; T = P2.tables(tr)
        te = [o for o in obs if o["day"] in ted]; rows = []
        for o in te:
            pn = P2.predict(T, o["setup"], o["cohort"], o["r"])["p"]; po, p0 = old_predict(tr, o); rows.append((pn, po, p0, o["y"]))
        bs = lambda k: (lambda xs: round(sum((p - y)**2 for p, y in xs)/len(xs), 4) if xs else None)([(r[k], r[3]) for r in rows if r[k] is not None])
        folds.append(dict(train=f"{trd[0]}..{trd[-1]} ({len(trd)})", test=f"{ted[0]}..{ted[-1]} ({len(ted)})", n_test=len(rows),
                          n_new_covered=sum(r[0] is not None for r in rows), brier_new=bs(0), brier_old=bs(1), brier_base=bs(2),
                          brier_old_same_obs=(lambda xs: round(sum((r[1]-r[3])**2 for r in xs)/len(xs), 4) if xs else None)([r for r in rows if r[0] is not None]),
                          brier_base_same_obs=(lambda xs: round(sum((r[2]-r[3])**2 for r in xs)/len(xs), 4) if xs else None)([r for r in rows if r[0] is not None])))
    # reliability (expanding forecasts, new model)
    rel = collections.defaultdict(lambda: [0, 0, 0.0])
    for i, f in fc.items():
        if f["new"] is None: continue
        k = min(int(f["new"]*5), 4); rel[k][0] += obs[i]["y"]; rel[k][1] += 1; rel[k][2] += f["new"]
    relt = {f"{20*k}-{20*k+20}%": dict(n=v[1], mean_fc=round(v[2]/v[1], 3), observed=round(v[0]/v[1], 3)) for k, v in sorted(rel.items())}
    ex = list(fc)
    S = dict(version=G.VERSION, built=E.now().isoformat(timespec="seconds"), source=src, days=[dorder[0], dorder[-1]], n_days=len(days),
             definition="P(target j touched before ORIGINAL stop and before 16:00 ET); decision at 3m close, entry = next 3m open; gap-aware; 1m resolves same-bar order where available; unresolved -> stop-first (target-first reported as sensitivity)",
             K=P2.K, min_n=P2.MIN_N, min_pool=P2.MIN_POOL, summary=summ, rr_buckets=bsum, folds=folds, reliability=relt,
             expanding=dict(n=len(ex), brier_new=brier(ex, "new"), brier_old=brier(ex, "old"), brier_base=brier(ex, "base"),
                            same_obs=dict(new=brier([i for i in ex if fc[i]["new"] is not None], "new"), old=brier([i for i in ex if fc[i]["new"] is not None], "old"), base=brier([i for i in ex if fc[i]["new"] is not None], "base"))), obs=obs)
    json.dump(S, open(OUT, "w"), indent=1, default=str)
    # ---- ledger
    rows = []; Tc = {}
    for k, e in enumerate(events):
        d = e["session_date"]; i = dorder.index(d); pf = ""
        if i >= 10 and e.get("status") == "entered":
            if d not in Tc: Tc[d] = P2.tables([o for o in obs if o["day"] < d])
            ps = [P2.predict(Tc[d], e["setup"], e["cohort"], r) for r in e["target_R"]]
            pf = " ".join("na" if p["p"] is None else f"{p['p']:.3f}(h{p['h']}/n{p['n']};sb{p['h_setup']}/{p['n_setup']};p0={p['prior_bucket']:.3f})" for p in ps)
        rows.append(dict(signal_id=f"{e['session_date']}-{e['bar']}-{e['setup'][:4]}-{'L' if e['side']==1 else 'S'}", episode_id=f"{e['session_date']}-{e['setup']}-{e['side']}-{e.get('attempt', '')}",
            strategy_version=e["strategy_version"], session_date=e["session_date"], setup=e["setup"], event_type=e.get("event_type"), cohort=e["cohort"], side=e["side"],
            bar_open_time=e["bar_open"].strftime("%H:%M"), decision_time=e["decision_time"].strftime("%H:%M"), entry_time=e.get("entry_time").strftime("%H:%M") if e.get("entry_time") is not None else "",
            status=e["status"], signal_close=round(e["signal_close"], 2), entry=round(e.get("entry", float("nan")), 2), initial_stop=round(e["stop"], 2),
            targets=" ".join(f"{k}:{v:.2f}" for k, v in e["targets"]), daily_atr=round(e["daily_atr"], 3), daily_reference_date=e["daily_ref_date"],
            target_R=" ".join(f"{x:.2f}" for x in e.get("target_R", [])), risk_atr=round(e.get("risk_atr", float("nan")), 3), minutes_remaining=e["minutes_remaining"],
            beyond_trigger_atr=round(e["beyond_trigger_atr"], 3) if e.get("beyond_trigger_atr") is not None else "",
            outcomes=" ".join(e.get("outcomes", [])), outcomes_targetfirst=" ".join(e.get("outcomes_tf", [])), ambiguity=" ".join(str(int(a)) for a in e.get("amb", [])),
            timeout=e.get("timeout", ""), R_fixedT1=round(e["R_fixedT1"], 3) if e.get("R_fixedT1") is not None else "",
            probability=pf, probability_training_cutoff=dorder[i-1] if pf else "", K=P2.K, R_managed=round(e["R_managed"], 3) if e.get("R_managed") is not None else "", managed_exit=(e.get("managed_exit") or {}).get("why", ""), why=e.get("why", "")))
    pd.DataFrame(rows).to_csv(LEDGER, index=False)
    print(f"{src}: {len(days)} sessions {dorder[0]}..{dorder[-1]}, events {len(events)}, target-obs {len(obs)}")
    for k, v in summ.items():
        print(f"{k:38s} ev {v['events']:3d} ent {v['entered']:3d} canc {v['cancelled']} sess {v['sessions']:2d} T1 {v['t1_h']}/{v['t1_n']} "
              f"W{tuple(round(100*x) for x in v['t1_wilson']) if v['t1_n'] else ''} TO {v['timeouts']} amb {v['ambiguous']} medT1R {v['med_T1_R'] and round(v['med_T1_R'],2)} "
              f"R1 mean {v['R_fixedT1_mean'] and round(v['R_fixedT1_mean'],2)} med {v['R_fixedT1_median'] and round(v['R_fixedT1_median'],2)} atr {v['R_fixedT1_atr_mean'] and round(v['R_fixedT1_atr_mean'],3)} boot {v['R_fixedT1_atr_boot'] and tuple(round(x,3) for x in v['R_fixedT1_atr_boot'])} | Rm mean {v['R_managed_mean'] and round(v['R_managed_mean'],2)} med {v['R_managed_median'] and round(v['R_managed_median'],2)} atr {v['R_managed_atr_mean'] and round(v['R_managed_atr_mean'],3)} boot {v['R_managed_atr_boot'] and tuple(round(x,3) for x in v['R_managed_atr_boot'])} (n{v['R_managed_n']}) tiny {v['tiny_risk']} medrisk {v['med_risk_atr'] and round(v['med_risk_atr'],3)} T1boot {v['t1_boot'] and tuple(round(100*x) for x in v['t1_boot'])} T1tf {v['t1_targetfirst_amb'] and round(100*v['t1_targetfirst_amb'])}")
    print("RR", {b: (v['h'], v['n'], round(100*v['raw'])) for b, v in bsum.items()})
    print("folds", json.dumps(folds, indent=0)); print("expanding", S["expanding"]); print("reliability", relt)
if __name__ == "__main__": main()
