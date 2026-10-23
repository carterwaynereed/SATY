"""Signal loop: weekdays 09:30-16:00 ET, polls TradingView every POLL s, replays today's completed 3m bars, appends NEW
signals to signals.jsonl and rewrites latest.md. Never halts on data errors (logs, backs off, retries).
After 16:00 rebuilds stats/signal_stats.json once (build_stats.py), then sleeps until the next session."""
import os, sys, json, time, traceback, datetime as dt
import engine as E, core, probs2 as PR
HERE = E.HERE; JL = os.path.join(HERE, "signals_v2.jsonl"); MD = os.path.join(HERE, "latest.md")
LOG = os.path.join(HERE, "logs"); POLL = 20
os.makedirs(LOG, exist_ok=True)
def log(m):
    t = E.now(); line = f"{t:%H:%M:%S} {m}"
    with open(os.path.join(LOG, f"{t:%Y-%m-%d}.log"), "a") as f: f.write(line + "\n")
    print(line, flush=True)
def key(e): return f"v2|{e['decision_time']:%Y-%m-%d %H:%M}|{e['kind']}|{e.get('setup','')}|{e['side']}|{e.get('action','')}"
def seen_keys():
    s = set()
    if os.path.exists(JL):
        for ln in open(JL):
            try: s.add(json.loads(ln)["key"])
            except Exception: pass
    return s
def write_md(txt):
    tmp = MD + ".tmp"; open(tmp, "w").write(txt); os.replace(tmp, MD)
def main():
    log(f"=== saty_signals loop start pid {os.getpid()} (signal-only, no broker)")
    seen = seen_keys(); errs = 0; stats_day = None; S = PR.load(); started = E.now()
    while True:
        t = E.now()
        if not E.is_session(t):
            if t.weekday() < 5 and t.time() >= dt.time(16, 0) and stats_day != t.date():
                try:
                    import build_stats2; build_stats2.main(); S = PR.load(); log("nightly stats rebuilt")
                except Exception as e: log(f"stats rebuild failed: {e}")
                stats_day = t.date()
                try: write_md(core.render(core.state(S), title="Saty signals (session closed)"))
                except Exception as e: log(f"final md failed: {e}")
            time.sleep(60); continue
        try:
            X = core.state(S); new = 0
            for e in X["ev"]:
                k = key(e)
                if k in seen: continue
                d = core.enrich(e, S); d["key"] = k; d["data_source"] = X["src"].get("intraday")
                d["logged_at"] = E.now().isoformat(timespec="seconds"); d["backfilled"] = e["decision_time"] < started - dt.timedelta(minutes=4)
                with open(JL, "a") as f: f.write(json.dumps(d, default=str) + "\n")
                seen.add(k); new += 1
                log(f"SIGNAL {d['time_et']} {d.get('direction')} {d.get('setup')} {d.get('action','ENTRY')} " +
                    (f"[{d['cohort']}/{d['event_type']}] entry {d['entry']} stop {d['stop']} :: {PR.fmt(d['prob_target_before_stop'])}" if d['kind'] == 'ENTRY' else f"@{d['price']} {d['reason']}"))
            write_md(core.render(X, title="Saty signals (live)"))
            if X["stale"]: log(f"WARN {X['stale']}")
            if errs: log(f"recovered after {errs} errors")
            errs = 0
            if t.minute % 15 == 0 and t.second < POLL: log(f"heartbeat last {X['last']:.2f} po {X['po']:+.1f} bars {len(X['td'])} new {new}")
        except Exception as e:
            errs += 1; log(f"WARN data/compute error #{errs} (continuing): {type(e).__name__}: {e}")
            if errs == 1: log(traceback.format_exc().splitlines()[-3])
            time.sleep(min(120, 5*errs)); continue
        time.sleep(POLL)
if __name__ == "__main__": main()
