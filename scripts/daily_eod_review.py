#!/usr/bin/env python3
"""Daily descriptive EOD review and engine-health checks. Never edits baseline rules."""
from __future__ import annotations
import argparse, json, math, os
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'site'/'data'
STATE=ROOT/'.dashboard-state'
def read(path, fallback):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except (OSError,ValueError): return fallback
def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
def finite(x): return isinstance(x,(int,float)) and math.isfinite(x)
def main():
    p=argparse.ArgumentParser();p.add_argument('--data-dir',type=Path,default=DATA);p.add_argument('--state-dir',type=Path,default=STATE);p.add_argument('--now',help='ISO timestamp for deterministic tests');a=p.parse_args()
    data=a.data_dir; state=a.state_dir; now=datetime.fromisoformat(a.now.replace('Z','+00:00')) if a.now else datetime.now(timezone.utc)
    now=now.astimezone(timezone.utc); stamp=now.isoformat(timespec='seconds').replace('+00:00','Z')
    market=read(data/'market.json',{}); symbols=market.get('symbols',{}) if isinstance(market,dict) else {}
    reviews=read(data/'eod-review.json',{'schema_version':1,'sessions':[]}); alarms_doc=read(data/'health-alarms.json',{'schema_version':1,'alarms':[]})
    changes=read(data/'changelog.json',{'schema_version':1,'entries':[]})
    sessions=reviews.setdefault('sessions',[]); alarms=alarms_doc.setdefault('alarms',[]); changes_list=changes.setdefault('entries',[])
    date=now.date().isoformat(); prior=next((x for x in reversed(sessions) if x.get('session_date')==date),None)
    if prior: # idempotent same-day scheduled rerun: replace that date's computed record, preserve changelog/alarms
        sessions.remove(prior)
    allsignals=[]; wait_rows=[]; instrument_summary=[]; new_alarms=[]
    for symbol,snap in symbols.items():
        bars=[b for b in snap.get('bars',[]) if finite(b.get('close')) and finite(b.get('high')) and finite(b.get('low')) and isinstance(b.get('time'),str)]
        today=[b for b in bars if b['time'][:10]==date]
        m=snap.get('market',{}); atr=m.get('atr14') if finite(m.get('atr14')) and m.get('atr14')>0 else None
        signals=[x for x in snap.get('signals',[]) if str(x.get('decision_at',''))[:10]==date]
        for sig in signals:
            t=sig.get('decision_at',''); future=[b for b in today if b['time']>t][:5]
            side=sig.get('side'); entry=sig.get('entry') if finite(sig.get('entry')) else next((b['close'] for b in today if b['time']>=t),None)
            if future and finite(entry) and side in ('LONG','SHORT'):
                favorable=max(((b['high']-entry) if side=='LONG' else (entry-b['low']) for b in future))
                adverse=max(((entry-b['low']) if side=='LONG' else (b['high']-entry) for b in future))
                outcome='FAVORABLE_FIRST' if favorable>adverse else 'ADVERSE_FIRST' if adverse>favorable else 'TIE_OR_FLAT'
                allsignals.append({'symbol':symbol,'signal_id':sig.get('id'),'setup':sig.get('setup'),'side':side,'decision_at':t,'status':sig.get('status'),'grade':outcome,'horizon_bars':len(future),'favorable_excursion':round(favorable,6),'adverse_excursion':round(adverse,6),'atr14':atr,'note':'Descriptive next-five-confirmed-bars excursion, not a fill or trade return.'})
            else:
                allsignals.append({'symbol':symbol,'signal_id':sig.get('id'),'setup':sig.get('setup'),'side':side,'decision_at':t,'status':sig.get('status'),'grade':'UNRESOLVED','horizon_bars':len(future),'atr14':atr,'note':'Insufficient post-decision bars or side/entry; not scored.'})
        weights=snap.get('evidence_weights',{}); wait=float(weights.get('wait',0)) if finite(weights.get('wait')) else None
        move_atr=None
        if today and atr: move_atr=(max(b['high'] for b in today)-min(b['low'] for b in today))/atr
        wait_rows.append({'symbol':symbol,'wait_weight':wait,'move_atr':move_atr,'n_bars':len(today)})
        health=snap.get('health',{}); asof=health.get('price_asof'); age=health.get('age_seconds') if finite(health.get('age_seconds')) else ((datetime.fromisoformat(market.get('generated_at','').replace('Z','+00:00'))-datetime.fromisoformat(asof.replace('Z','+00:00'))).total_seconds() if isinstance(asof,str) and isinstance(market.get('generated_at'),str) else None)
        if snap.get('session',{}).get('status')=='OPEN' and (age is None or age>225):
            new_alarms.append({'type':'STALE_FEED','symbol':symbol,'at':stamp,'detail':f'Confirmed-bar feed stale/unavailable; age_seconds={round(age) if age is not None else None}. DATA HOLD required.'})
        if today and move_atr is not None and move_atr>=1.0 and wait is not None and wait>=90 and len(signals)==0:
            new_alarms.append({'type':'ENGINE_ALL_DAY_WAIT','symbol':symbol,'at':stamp,'detail':f'ENGINE CHECK: all-day WAIT while {symbol} moved {move_atr:.2f} ATR; wait_weight={wait:.0f}/100, bars_n={len(today)}. Review missed moves and gates.'})
        instrument_summary.append({'symbol':symbol,'n_bars':len(today),'n_signals':len(signals),'wait_weight':wait,'move_atr':round(move_atr,4) if move_atr is not None else None,'feed_age_seconds':round(age) if age is not None else None})
    if len(sessions)>=2:
        recent=sessions[-2:]
        for symbol in symbols:
            vals=[x.get('weights',{}).get(symbol) for x in recent]
            if all(v is not None for v in vals) and vals[0]==vals[1]:
                new_alarms.append({'type':'WEIGHTS_STUCK','symbol':symbol,'at':stamp,'detail':'Directional evidence weights unchanged across at least two daily reviews; verify feed and calculation path.'})
        for symbol in symbols:
            recent_rows=[x for x in sessions[-3:] if any(i.get('symbol')==symbol for i in x.get('instruments',[]))]
            if len(recent_rows)>=2 and all(next(i for i in x['instruments'] if i['symbol']==symbol).get('n_signals',0)==0 for x in recent_rows):
                new_alarms.append({'type':'ZERO_SETUPS_2_SESSIONS','symbol':symbol,'at':stamp,'detail':'No setups in 2+ reviewed sessions; inspect engine health, gates and feed before interpreting as market conditions.'})
        for symbol in symbols:
            directions=[]
            for x in sessions[-5:]:
                directions += [z.get('side') for z in x.get('signals',[]) if z.get('symbol')==symbol and z.get('side') in ('LONG','SHORT')]
            if len(directions)>=5 and (directions.count('LONG')==0 or directions.count('SHORT')==0):
                new_alarms.append({'type':'ONE_SIDED_CALLS','symbol':symbol,'at':stamp,'detail':f'Only one direction in last reviewed signals (n={len(directions)}); inspect directional bias and sample coverage.'})
    for alarm in new_alarms:
        if not any(x.get('type')==alarm['type'] and x.get('symbol')==alarm.get('symbol') and x.get('at','')[:10]==date for x in alarms):
            alarms.append(alarm)
            if alarm['type'] in ('ENGINE_ALL_DAY_WAIT','STALE_FEED','WEIGHTS_STUCK','ZERO_SETUPS_2_SESSIONS','ONE_SIDED_CALLS'):
                cid=f"CHAL-{date.replace('-','')}-{alarm['symbol']}-{alarm['type']}"
                changes_list.append({'date':date,'at':stamp,'type':'CHALLENGER_REGISTERED','candidate_id':cid,'trigger':alarm['type'],'baseline_unchanged':True,'promotion':'NOT_PROMOTED','note':'Shadow candidate only. Paired same-session evaluation required; promotion gates remain >=30 sessions, >=100 independent episodes, session-cluster uncertainty, costs/delay stress, guardrails, and reviewed PR.'})
                chpath=data/'challengers.jsonl'
                chpath.parent.mkdir(exist_ok=True)
                old=chpath.read_text(encoding='utf-8') if chpath.exists() else ''
                rec={'record_id':cid,'candidate_id':cid,'recorded_at':stamp,'status':'REGISTERED','supersedes_record_id':None,'baseline_commit':os.getenv('GITHUB_SHA'),'challenger_commit':None,'strategy_version':'saty-sig-2.0-shadow','evidence_hash':None,'registered_at':stamp,'evaluation_start':date,'evaluation_end':None,'review_date':None,'primary_metric':'paired session-level missed-move coverage versus frozen baseline','minimum_effect':'Pre-register before evaluation; not set by alarm run','decision_rule':'No promotion without >=30 sessions and >=100 nonduplicated episodes plus all registered gates','guardrails':['No change to live baseline','Signal-only; no orders','Report n and uncertainty intervals','Costs, delay and session-cluster sensitivity required'],'session_calendar':'XNYS','source_and_session_basis':'TradingView confirmed bars; RTH','episode_definition':'One alarm-triggered session episode, deduplicated by symbol/date/type','overlap_policy':'One episode per symbol/date/alarm type','cost_and_delay_assumptions':'Must be preregistered before prospective test','multiplicity_and_stopping_plan':'Fixed review date and registered hypothesis required','exclusion_rules':['Stale or incomplete bars remain DATA HOLD'],'results':{'sessions':0,'eligible_episodes':0,'independent_episode_count':0,'coverage':None,'primary_effect':None,'confidence_interval':None,'session_cluster_method':None,'guardrail_results':[],'cost_stress_results':[],'calibration':None,'failures':['Automatically registered from health alarm; no performance evidence yet']},'decision':None,'reviewed_by':None,'reviewed_at':None,'promotion_pr':None,'rollback_commit':None}
                if cid not in old: chpath.open('a',encoding='utf-8').write(json.dumps(rec,separators=(',',':'))+'\n')
    counts={'signals':len(allsignals),'graded':sum(x['grade'] not in ('UNRESOLVED',) for x in allsignals),'unresolved':sum(x['grade']=='UNRESOLVED' for x in allsignals),'wait_decisions':sum(1 for x in wait_rows if x.get('wait_weight',0)>=90),'instruments':len(instrument_summary)}
    graded=[x for x in allsignals if x['grade']!='UNRESOLVED'];wins=sum(x['grade']=='FAVORABLE_FIRST' for x in graded);n=len(graded)
    rate=wins/n if n else None
    # Wilson 95% interval for a descriptive favorable-first fraction.
    interval=None
    if n:
        z=1.96;den=1+z*z/n;center=(rate+z*z/(2*n))/den;half=z*math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/den;interval=[round(max(0,center-half),4),round(min(1,center+half),4)]
    review={'session_date':date,'reviewed_at':stamp,'signal_count':len(allsignals),'wait_count':counts['wait_decisions'],'graded_count':n,'unresolved_count':counts['unresolved'],'favorable_first_rate':round(rate,4) if rate is not None else None,'favorable_first_interval_95_wilson':interval,'sample_n':n,'signals':allsignals,'instruments':instrument_summary,'weights':{sym:snap.get('evidence_weights') for sym,snap in symbols.items()},'lesson':('Reviewed '+str(len(allsignals))+' signal observations; '+str(counts['unresolved'])+' unresolved due to missing follow-through bars. Challenger rules remain shadow-only.'),'alarms_created':new_alarms,'wait_assessment':'The published snapshot exposes only the latest directional evidence allocation, not a per-bar historical WAIT ledger. WAIT count is a current-state proxy and is not represented as a count of every intraday WAIT. The all-day-WAIT alarm requires no recorded signal plus current WAIT >=90 and a daily range >=1 ATR; inspect missed moves manually.','note':'Descriptive price excursion grading only; not P&L, not an options forecast, not an executable fill. Rates use n and Wilson intervals; session dependence remains.'}
    sessions.append(review);reviews['sessions']=sessions[-180:];alarms_doc['alarms']=alarms[-1000:];changes['entries']=changes_list[-1000:]
    write(data/'eod-review.json',reviews);write(data/'health-alarms.json',alarms_doc);write(data/'changelog.json',changes)
    print(json.dumps({'date':date,'signal_n':len(allsignals),'graded_n':n,'unresolved_n':counts['unresolved'],'alarm_n':len(new_alarms),'challenger_candidates_created':sum(1 for x in new_alarms if x['type'] in ('ENGINE_ALL_DAY_WAIT','STALE_FEED','WEIGHTS_STUCK','ZERO_SETUPS_2_SESSIONS','ONE_SIDED_CALLS')),'interval_95_wilson':interval},indent=2))
if __name__=='__main__': main()
