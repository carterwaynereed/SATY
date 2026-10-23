"""Probability-weighted sizing (regularized). Per-setup Beta-binomial win rate (prior = pooled backtest rate, strength K)
and per-setup payoff ratio shrunk to pooled. Kelly f* = p - (1-p)/b; multiplier = clip(KELLY_FRAC * f*/f_pool, 0, MAX_MULT).
Negative edge -> 0 (skip). Trained by tests/bt_prob.py on backtest trades; review.py --update-model adds paper/live results
(only when run with that flag; parameters of the strategy itself are never changed)."""
import json, os
PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stats", "prob_model.json")
K = 10.0; KB = 10.0; KELLY_FRAC = 1.0; MAX_MULT = 2.0
def fit(rows):
    """rows: [(setup, pnl_dollars)] -> model dict"""
    w = [p for _, p in rows if p > 0]; l = [-p for _, p in rows if p <= 0]
    pw = (len(w) + 1) / (len(rows) + 2); bw = (sum(w)/len(w) if w else 1) / (sum(l)/len(l) if l else 1)
    m = dict(pool=dict(n=len(rows), p=pw, b=bw), setups={})
    for st in sorted({s for s, _ in rows}):
        r = [p for s, p in rows if s == st]; ww = [p for p in r if p > 0]; ll = [-p for p in r if p <= 0]
        m["setups"][st] = dict(n=len(r), wins=len(ww), losses=len(ll), sum_win=sum(ww), sum_loss=sum(ll))
    return m
def est(m, setup):
    P = m["pool"]; s = m["setups"].get(setup)
    if not s: return P["p"], P["b"]
    p = (s["wins"] + K*P["p"]) / (s["n"] + K)
    braw = (s["sum_win"]/s["wins"] if s["wins"] else P["b"]) / (s["sum_loss"]/s["losses"] if s["losses"] else 1) if s["losses"] else P["b"]
    w = s["n"]/(s["n"] + KB); b = w*braw + (1-w)*P["b"]
    return p, b
def kelly(p, b): return p - (1-p)/b if b > 0 else -1
def multiplier(m, setup, tier=None):
    P = m["pool"]; fp = kelly(P["p"], P["b"]); f = kelly(*est(m, setup))
    if f <= 0: return 0.0
    return max(0.0, min(MAX_MULT, KELLY_FRAC * f / max(fp, 0.05)))
def load(path=PATH): return json.load(open(path))
def save(m, path=PATH): os.makedirs(os.path.dirname(path), exist_ok=True); json.dump(m, open(path, "w"), indent=1)
