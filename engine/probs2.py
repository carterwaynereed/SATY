"""Probability model v2 (saty-sig-2). Definition: P(target j touched before the ORIGINAL stop and before 16:00 ET),
reference entry = next 3m open, stop-first on unresolved same-bar ambiguity, 1m bars used to resolve ordering where available.
Estimator: hierarchical shrinkage on reward-to-risk bucket (target distance / initial risk):
  p_b   = pooled rate of the RR bucket (all setups)            [training data only]
  p_sb  = (h_sb + K*p_b)/(n_sb + K)     setup x bucket
  p_scb = (h_scb + K*p_sb)/(n_scb + K)  setup x cohort x bucket  <- displayed
Raw h/n and 95% Wilson interval of the cell are always shown. No % when the bucket pool n < MIN_POOL or setup x bucket n < MIN_N."""
import json, os, math, collections
from sig2 import rr_bucket
HERE = os.path.dirname(os.path.abspath(__file__)); PATH = os.path.join(HERE, "stats", "signal_stats_v2.json")
K = 10.0; MIN_N = 5; MIN_POOL = 20
def wilson(h, n, z=1.96):
    if n == 0: return (None, None)
    p = h/n; d = 1 + z*z/n; c = p + z*z/(2*n); w = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return ((c - w)/d, (c + w)/d)
def tables(obs):
    """obs: iterable of dict(setup, cohort, b, y). Returns count tables."""
    T = dict(b=collections.Counter(), bn=collections.Counter(), sb=collections.Counter(), sbn=collections.Counter(),
             scb=collections.Counter(), scbn=collections.Counter())
    for o in obs:
        T["b"][o["b"]] += o["y"]; T["bn"][o["b"]] += 1
        T["sb"][(o["setup"], o["b"])] += o["y"]; T["sbn"][(o["setup"], o["b"])] += 1
        T["scb"][(o["setup"], o["cohort"], o["b"])] += o["y"]; T["scbn"][(o["setup"], o["cohort"], o["b"])] += 1
    return T
def predict(T, setup, cohort, r):
    b = rr_bucket(r); nb = T["bn"][b]
    if nb < MIN_POOL: return dict(p=None, bucket=b, note=f"RR bucket {b} too thin (pool n={nb})")
    pb = T["b"][b]/nb
    hs, ns = T["sb"][(setup, b)], T["sbn"][(setup, b)]
    if ns < MIN_N: return dict(p=None, bucket=b, n=ns, h=hs, prior=round(pb, 3), note=f"{setup} has n={ns} at {b} (pool {b}: {100*pb:.0f}% of {nb})")
    psb = (hs + K*pb)/(ns + K)
    h, n = T["scb"][(setup, cohort, b)], T["scbn"][(setup, cohort, b)]
    p = (h + K*psb)/(n + K)
    return dict(p=p, bucket=b, h=h, n=n, h_setup=hs, n_setup=ns, prior_bucket=pb, wilson=wilson(h, n) if n else wilson(hs, ns), note="")
_cache = {}
def load():
    if not os.path.exists(PATH): return None
    m = os.path.getmtime(PATH)
    if _cache.get("m") != m:
        S = json.load(open(PATH)); S["T"] = tables(S["obs"]); _cache.update(m=m, S=S)
    return _cache["S"]
def target_probs(S, setup, cohort, entry, stop, targets):
    out = []; risk = abs(entry - stop)
    for k, v in targets[:3]:
        r = abs(v - entry)/risk if risk > 0 else 0
        d = predict(S["T"], setup, cohort, r) if S else dict(p=None, note="no stats")
        d.update(target=k, level=round(v, 2), R=round(r, 2), be=round(100*risk/(risk + abs(v - entry)), 1)); out.append(d)
    return out
def fmt(pr):
    s = []
    for x in pr:
        if x.get("p") is None: s.append(f"{x['target']} {x['level']} ({x['R']}R): no % — {x['note']}")
        else:
            lo, hi = x["wilson"]; s.append(f"{x['target']} {x['level']} ({x['R']}R, b/e {x['be']}%): {100*x['p']:.0f}% [cell {x['h']}/{x['n']}, setup@{x['bucket']} {x['h_setup']}/{x['n_setup']}, 95% Wilson {100*lo:.0f}-{100*hi:.0f}%]")
    return "; ".join(s)
