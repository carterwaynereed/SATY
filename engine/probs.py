"""Probability lookup. Primary: stats/signal_stats.json (build_stats.py) = historical rate of touching T1/T2/T3 before
the stop, per setup. Shown as raw hits/n plus a smoothed % (Beta-binomial shrink toward the all-setup pooled rate,
K=10 pseudo-trades, same idea as the scalper's probmodel.py). n < MIN_N -> no % is given (sample too thin).
Secondary: stats/prob_model_scalper.json = the scalper's backtest trade win-rate (P&L>0) per setup (Sep 16-Oct 13)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
K = 10.0; MIN_N = 5; THIN_N = 20
def load():
    p = os.path.join(HERE, "stats", "signal_stats.json")
    return json.load(open(p)) if os.path.exists(p) else None
def load_pm():
    p = os.path.join(HERE, "stats", "prob_model_scalper.json")
    return json.load(open(p)) if os.path.exists(p) else None
def target_probs(S, setup, targets):
    out = []
    if not S: return [dict(target=k, level=round(v, 2), p=None, note="no stats file; run build_stats.py") for k, v in targets]
    st = S["setups"].get(setup); P = S["pool"]
    for i, (k, v) in enumerate(targets[:3]):
        if not st or st["ntgt"][i] < MIN_N:
            n = st["ntgt"][i] if st else 0
            out.append(dict(target=k, level=round(v, 2), p=None, hits=st["hits"][i] if st else 0, n=n,
                            note=f"sample too thin (n={n}) - no probability given")); continue
        h, n = st["hits"][i], st["ntgt"][i]; pr = P["hits"][i]/P["ntgt"][i] if P["ntgt"][i] else 0.5
        p = (h + K*pr)/(n + K)
        out.append(dict(target=k, level=round(v, 2), p=round(100*p, 1), raw=round(100*h/n, 1), hits=h, n=n,
                        note="thin sample" if n < THIN_N else ""))
    return out
def trade_winrate(setup):
    m = load_pm()
    if not m: return None
    s = m["setups"].get(setup)
    if not s: return None
    import sys; sys.path.insert(0, os.path.join(HERE, "lib")); import probmodel
    p, b = probmodel.est(m, setup)
    return dict(p=round(100*p, 1), wins=s["wins"], n=s["n"], payoff=round(b, 2), src="scalper backtest Sep16-Oct13 (P&L>0, partial at T1)")
def fmt(pr):
    return ", ".join(f"{x['target']} {x['level']}: " + (f"{x['p']}% ({x['hits']}/{x['n']}{', '+x['note'] if x['note'] else ''})" if x['p'] is not None else x['note']) for x in pr)
