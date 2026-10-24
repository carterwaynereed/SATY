#!/usr/bin/env python3
"""After-close research review from immutable decisions, bars and public inputs.

Never relabel a latest score as all-day WAIT. Replay-late and observed decisions
have separate denominators. Alarms are inspection requests, not proof of a bug.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
ET=ZoneInfo('America/New_York')

def read(p,default):
    try: return json.loads(p.read_text())
    except FileNotFoundError: return default

def lines(p):
    try: return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
    except FileNotFoundError: return []

def write(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')

def finite(x): return not isinstance(x,bool) and isinstance(x,(int,float)) and math.isfinite(x)
def dt(s): return datetime.fromisoformat(s.replace('Z','+00:00'))
def dayof(s): return dt(s).astimezone(ET).date().isoformat()

def rate(h,n):
    interval=None
    if n:
        p=h/n;z=1.959963984540054;den=1+z*z/n;c=(p+z*z/(2*n))/den
        half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;interval=[max(0,c-half),min(1,c+half)]
    return {'hits':h,'n':n,'rate':h/n if n else None,'wilson_95':interval,
            'method':'Wilson 95%, descriptive; overlapping intraday observations are correlated'}

def grade(decision,bars,close):
    at=dt(decision['time']);end=dt(close);price=decision.get('close');atr=decision.get('atr14')
    future=[b for b in bars if dt(b['time'])>=at][:5]
    expected=min(5,int((end-at).total_seconds()//180))
    valid=expected>0 and len(future)==expected and all((dt(b['time'])-at).total_seconds()==i*180 for i,b in enumerate(future))
    base={'id':decision['id'],'symbol':decision['symbol'],'decision':decision['decision'],
          'time':decision['time'],'observed_at':decision['observed_at'],'observation_kind':decision['observation_kind'],
          'horizon_bars':len(future),'grade':'UNRESOLVED'}
    if not valid or not finite(price) or not finite(atr) or atr<=0: return base
    up=max(0,max(b['high'] for b in future)-price);down=max(0,price-min(b['low'] for b in future))
    base.update(up_atr=up/atr,down_atr=down/atr)
    if decision['decision']=='WAIT':
        base['grade']='MISSED_MOVE_CONTEXT' if max(up,down)/atr>=0.25 else 'SMALL_MOVE_CONTEXT'
    else:
        favorable,adverse=(up,down) if decision['decision']=='CALL' else (down,up)
        base.update(favorable_excursion=favorable,adverse_excursion=adverse,
                    grade='FAVORABLE_EXCURSION_DOMINANT' if favorable>adverse else 'ADVERSE_EXCURSION_DOMINANT' if adverse>favorable else 'TIE_OR_FLAT')
    return base

RULE={'kind':'atr_cross','trigger_atr':0.236,'confirmation':'relaxed','risk_atr':0.15,'target_r':1,'horizon_bars':5}

def register_challengers(data,alarms,stamp,changes):
    path=data/'challengers.jsonl';existing=lines(path);latest={x['candidate_id']:x for x in existing}
    # Legacy text-only diagnostics are retained, but not advertised as executable.
    for alarm in alarms:
        cid=f"CHAL-{stamp[:10].replace('-','')}-{alarm['symbol']}-{alarm['type']}"
        if cid in latest: continue
        rec={'record_id':cid,'candidate_id':cid,'symbol':alarm['symbol'],'recorded_at':stamp,
             'status':'QUEUED','registered_at':None,'trigger':alarm['type'],'rule_set':None,
             'baseline_version':'saty-sig-2.0','baseline_commit':os.getenv('GITHUB_SHA'),
             'promotion':'NOT_PROMOTED','supersedes_record_id':None}
        existing.append(rec);latest[cid]=rec
        changes.append({'date':stamp[:10],'at':stamp,'type':'CHALLENGER_QUEUED','candidate_id':cid,
                        'trigger':alarm['type'],'baseline_unchanged':True,'promotion':'NOT_PROMOTED'})
    active=[c for c in latest.values() if c.get('status')=='SHADOW' and c.get('rule_set')]
    if len(active)>1: raise ValueError('More than one active shadow challenger')
    if not active:
        queued=[c for c in latest.values() if c.get('status') in ('QUEUED','REGISTERED') and not c.get('rule_set')]
        if queued:
            old=queued[0];cid=old['candidate_id'];symbol=old.get('symbol') or next((s for s in ('SPY','SPX','AAPL','GOOGL') if '-'+s+'-' in cid),None)
            if symbol:
                rule=dict(RULE)
                if any(k in cid for k in ('STALE_FEED','WEIGHTS_STUCK','REVIEW_DATA_INCOMPLETE')):
                    rule['kind']='baseline';rule['confirmation']='strict'
                rec={**old,'record_id':cid+'-executable-v1','supersedes_record_id':old['record_id'],
                     'status':'SHADOW','registered_at':stamp,'symbol':symbol,'rule_set':rule,
                     'evaluation_start':'FIRST_SESSION_OPEN_AFTER_REGISTRATION','minimum_sessions':30,'minimum_episodes':100,
                     'primary_metric':'Paired complete-session R difference under common 1R/5-bar research exits',
                     'minimum_effect':0.05,'decision_rule':'Mean paired delta >= 0.05 R/session; session-cluster lower interval > 0; all guardrails and reviewed PR required',
                     'review_schedule':'No promotion before 30 subsequent sessions and 100 resolved nonoverlapping episodes; fixed checkpoint review',
                     'cost_and_delay_stress':'0, $0.02, $0.05 per share per side and one extra 3m bar entry delay',
                     'automatic_promotion':False,'outcome_event':'Target before original stop, next-open reference, stop-first ties, five 3m bars or close',
                     'rule_delta':'Fresh ATR 23.6 crossing with 13/48 confirmation only' if rule['kind']=='atr_cross' else 'Exact baseline replay diagnostic; freshness is never relaxed'}
                existing.append(rec)
                changes.append({'date':stamp[:10],'at':stamp,'type':'SHADOW_RULE_FROZEN','candidate_id':cid,
                                'rule_set':rule,'baseline_unchanged':True,'promotion':'NOT_PROMOTED'})
    path.write_text(''.join(json.dumps(x,separators=(',',':'))+'\n' for x in existing))


def review(data,state,now):
    date=now.astimezone(ET).date().isoformat();stamp=now.isoformat()
    calendar=read(ROOT/'hosting/session-calendar.json',{'sessions':{}})['sessions'];session=calendar.get(date)
    if not session or now<dt(session['close']):
        return {'date':date,'skipped':'No completed exchange session for this ET date'}
    market=read(data/'market.json',{});raw=lines(state/'decisions'/f'{date}.jsonl')
    # First observation wins. Later revisions never overwrite issued evidence.
    unique={}
    for row in raw: unique.setdefault(row['id'],row)
    captures=lines(state/'captures'/f'{date}.jsonl')
    observed=[];late=[];alarms=[];instruments=[]
    def alarm(kind,symbol,detail):
        alarms.append({'type':kind,'symbol':symbol,'at':stamp,'session_date':date,'detail':detail,
                       'interpretation':'ENGINE CHECK / diagnostic, not proof of malfunction or a missed profitable trade'})
    expected=int((dt(session['close'])-dt(session['open'])).total_seconds()/180)
    for symbol in ('SPY','SPX','AAPL','GOOGL'):
        snap=market.get('symbols',{}).get(symbol,{})
        archive=read(state/'bars'/date/f'{symbol}.json',None)
        bars=(archive or snap).get('bars',[])
        bars=[b for b in bars if dayof(b['time'])==date and all(finite(b.get(k)) for k in ('high','low','close'))]
        source=(archive or {}).get('source',snap.get('health',{}).get('source',{})).get('feed_fingerprint')
        own=[r for r in unique.values() if r['symbol']==symbol and r.get('session_date')==date and (not source or r.get('source_fingerprint')==source)]
        # Versioned policies must not double-count one bar across the cutover.
        for version in ('carter-score60-softcap-1.1', 'carter-score60-runner-1.0'):
            if any(r.get('strategy_version') == version for r in own):
                own=[r for r in own if r.get('strategy_version') == version]
                break
        seen=[r for r in own if r.get('observation_kind')=='OBSERVED'];backfill=[r for r in own if r.get('observation_kind')=='REPLAY_LATE']
        observed.extend(grade(r,bars,session['close']) for r in seen);late.extend(grade(r,bars,session['close']) for r in backfill)
        atr=next((r.get('atr14') for r in own if finite(r.get('atr14')) and r['atr14']>0),snap.get('market',{}).get('atr14'))
        move=(max(b['high'] for b in bars)-min(b['low'] for b in bars))/atr if bars and finite(atr) and atr>0 else None
        wait=sum(r['decision']=='WAIT' for r in seen);entries=[r for r in own if r['decision'] in ('CALL','PUT')]
        if len(seen)==expected and wait==expected and move is not None and move>=1:
            alarm('ENGINE_ALL_DAY_WAIT',symbol,f'ENGINE CHECK: all-day WAIT while {symbol} moved {move:.2f} ATR; observed WAIT n={wait}/{expected}. Inspect rule gates; WAIT may be correct.')
        elif own and len(own)==expected and not entries and move is not None and move>=1:
            alarm('WAIT_REPLAY_CHECK',symbol,f'Replayed baseline WAIT on {len(own)} bars while range was {move:.2f} ATR; only {len(seen)}/{expected} observed within freshness. Not an observed all-day-WAIT claim.')
        if len(own)<expected or len(bars)<expected:
            alarm('REVIEW_DATA_INCOMPLETE',symbol,f'Ledger n={len(own)}/{expected}; recorded bars n={len(bars)}/{expected}. No current-state WAIT proxy is used.')
        stale=[c for c in captures if c['symbol']==symbol and c['state'] in ('UNAVAILABLE','STALE')]
        health=snap.get('health',{})
        if stale or snap.get('session',{}).get('status')=='OPEN' and (not finite(health.get('age_seconds')) or health['age_seconds']>225):
            alarm('STALE_FEED',symbol,f'Stale/unavailable capture observations n={len(stale)}; retain DATA HOLD. Missing 1m state is reported separately.')
        weight_values={json.dumps(r['evidence_score'],sort_keys=True) for r in seen}
        if len(seen)>=20 and len(weight_values)==1 and len({r['close'] for r in seen})>1:
            alarm('WEIGHTS_STUCK',symbol,f'Same allocation across observed bars n={len(seen)} despite changing price. A persistent trend can also explain this; recompute before changing rules.')
        instruments.append({'symbol':symbol,'n_bars':len(bars),'expected_bars':expected,'ledger_n':len(own),
                            'observed_n':len(seen),'replay_late_n':len(backfill),'wait_n':wait,'n_signals':len(entries),
                            'move_atr':move,'coverage_complete':len(own)==expected and len(bars)==expected,
                            'one_minute_state':snap.get('one_minute_health',{}).get('state','UNAVAILABLE'),
                            'direction_counts':dict(Counter(r['decision'] for r in entries))})
    archive_reviews=state/'reviews';archive_reviews.mkdir(parents=True,exist_ok=True)
    previous=[read(p,{}) for p in sorted(archive_reviews.glob('*.json')) if p.stem<date]
    for item in instruments:
        rows=[i for r in previous[-4:] for i in r.get('instruments',[]) if i.get('symbol')==item['symbol'] and i.get('coverage_complete')]+([item] if item['coverage_complete'] else [])
        if len(rows)>=2 and all(i['n_signals']==0 for i in rows[-2:]):
            alarm('ZERO_SETUPS_2_SESSIONS',item['symbol'],'Zero new baseline setups in two fully covered sessions; inspect constraints and market context.')
        counts=Counter();[counts.update(i.get('direction_counts',{})) for i in rows]
        if len(rows)>=5 and sum(counts.values())>=20 and (not counts['CALL'] or not counts['PUT']):
            alarm('ONE_SIDED_CALLS',item['symbol'],f'One-sided baseline entries across sessions n={len(rows)}, signals n={sum(counts.values())}. Test symmetry; trend bias alone is not an error.')
    # Manual observations retain source time AND receipt time. Later edits cannot
    # become pre-close predictors. Lesson paraphrases may be added after close.
    inputs=[]
    for p in sorted((state/'inputs').glob('*.json')) if (state/'inputs').exists() else []:
        v=read(p,{})
        if dayof(v['received_at'])==date:
            inputs.append({'input_id':v['input_id'],'symbol':v['symbol'],'asof':v['asof'],'received_at':v['received_at'],
                           'available_before_close':dt(v['received_at'])<=dt(session['close']) and dt(v['asof'])<=dt(session['close']),
                           'contracts_n':len(v.get('leaderboard',[])),'gex_nodes_n':len((v.get('gex') or {}).get('nodes',[])),
                           'max_pain':v.get('max_pain'),'lessons':v.get('lessons',[])})
    signals=[r for r in observed if r['decision'] in ('CALL','PUT')];waits=[r for r in observed if r['decision']=='WAIT']
    scored=[r for r in signals if r['grade']!='UNRESOLVED'];scored_wait=[r for r in waits if r['grade']!='UNRESOLVED']
    evidence=rate(sum(r['grade']=='FAVORABLE_EXCURSION_DOMINANT' for r in scored),len(scored))
    missed=rate(sum(r['grade']=='MISSED_MOVE_CONTEXT' for r in scored_wait),len(scored_wait))
    lessons=[x for v in inputs for x in v['lessons']]
    report={'schema_version':1,'session_date':date,'reviewed_at':stamp,'signal_count':len(signals),'wait_count':len(waits),
            'graded_count':len(scored),'sample_n':len(scored),'unresolved_count':len(signals)-len(scored),
            'favorable_excursion_dominant_rate':evidence['rate'],'favorable_excursion_dominant_interval_95_wilson':evidence['wilson_95'],
            'signal_evidence':evidence,'wait_missed_move_evidence':missed,'signals':signals,'waits':waits,
            'replay_late_count':len(late),'replay_late_grades':late,'instruments':instruments,'manual_inputs':inputs,
            'manual_inputs_n':len(inputs),'lesson_candidates':lessons,'lesson_candidates_n':len(lessons),
            'lesson':f'Observed signals n={len(signals)}; WAIT decisions n={len(waits)}; late replay rows n={len(late)} kept separate. Public manual inputs n={len(inputs)}, lesson candidates n={len(lessons)}. No live rule changed.',
            'wait_assessment':'Counts come only from immutable per-bar observations. OBSERVED requires first receipt within 225s of bar close, not an executable next-open fill. Late reconstructions are separate. WAIT is no new managed entry, not a claim that price will be flat.',
            'shadow_evidence_path':'shadow-evidence.json','alarms_created':alarms,
            'note':'Next-five-bars excursion comparison, not first-touch ordering or options P&L. WAIT missed move means >=0.25 daily ATR excursion, not a profitable opportunity.'}
    changes=read(data/'changelog.json',{'schema_version':1,'entries':[]})
    register_challengers(data,alarms,stamp,changes['entries'])
    write(archive_reviews/f'{date}.json',report)
    # Public page is small; full every-bar reviews stay in dashboard-data/state.
    summaries=[]
    for p in sorted(archive_reviews.glob('*.json'))[-10:]:
        r=read(p,{})
        summaries.append({k:v for k,v in r.items() if k not in ('signals','waits','replay_late_grades','manual_inputs','alarms_created')})
    alarmdoc=read(data/'health-alarms.json',{'schema_version':1,'alarms':[]})
    old=[x for x in alarmdoc['alarms'] if x.get('session_date',x.get('at','')[:10])!=date]
    alarmdoc['alarms']=(old+alarms)[-100:];changes['entries']=changes['entries'][-100:]
    write(data/'eod-review.json',{'schema_version':1,'sessions':summaries,'archive':'state/reviews/'})
    write(data/'health-alarms.json',alarmdoc);write(data/'changelog.json',changes)
    return {'date':date,'signal_n':len(signals),'wait_n':len(waits),'replay_late_n':len(late),
            'alarm_n':len(alarms),'sample_n':evidence['n'],'wilson_95':evidence['wilson_95'],
            'challenger_candidates_created':len(alarms),'live_rules_changed':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('--data-dir',type=Path,default=ROOT/'site/data')
    p.add_argument('--state-dir',type=Path,default=ROOT/'.dashboard-state/state');p.add_argument('--now')
    a=p.parse_args();now=dt(a.now) if a.now else datetime.now(timezone.utc)
    if now.tzinfo is None: raise ValueError('Aware timestamp required')
    print(json.dumps(review(a.data_dir,a.state_dir,now.astimezone(timezone.utc))))
if __name__=='__main__': main()
