// Frozen research policies. These outputs are never imported by the live signal UI.
import {createHash} from 'node:crypto';
import {replaySaty,etParts} from './saty-live.mjs';
export const SHADOW_VERSION='shadow-barrier-1.0';
export const DEFAULT_RULE=Object.freeze({kind:'atr_cross',trigger_atr:0.236,confirmation:'relaxed',risk_atr:0.15,target_r:1,horizon_bars:5});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function ruleHash(rule){validateRule(rule);return hash(rule);}
export function validateRule(r){
  if(!r||Object.keys(r).some(k=>!['kind','trigger_atr','confirmation','risk_atr','target_r','horizon_bars'].includes(k)))throw Error('Unknown shadow rule fields');
  if(!['atr_cross','baseline'].includes(r.kind)||!['strict','relaxed','none'].includes(r.confirmation))throw Error('Unknown shadow rule mode');
  if(!Number.isFinite(r.trigger_atr)||r.trigger_atr<0.1||r.trigger_atr>0.5||!Number.isFinite(r.risk_atr)||r.risk_atr<0.05||r.risk_atr>1||!Number.isFinite(r.target_r)||r.target_r<0.5||r.target_r>3||!Number.isInteger(r.horizon_bars)||r.horizon_bars<1||r.horizon_bars>20)throw Error('Shadow rule parameter outside registered bounds');
  return r;
}
export function wilson(hits,n){
  if(!Number.isInteger(n)||!Number.isInteger(hits)||hits<0||hits>n)throw Error('Invalid event counts');
  if(!n)return null;
  const z=1.959963984540054,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
export function summarizeEpisodes(episodes){
  const resolved=episodes.filter(x=>['TARGET_FIRST','STOP_FIRST','TIMEOUT'].includes(x.outcome));
  const hits=resolved.filter(x=>x.outcome==='TARGET_FIRST').length,n=resolved.length;
  return {event:'Target touched before original stop within five 3m bars (or registered horizon), stop-first ties',
    hits,n,rate:n?hits/n:null,wilson_95:wilson(hits,n),
    interval_method:'Wilson 95%, descriptive; intraday episodes are correlated',
    unresolved_n:episodes.filter(x=>x.outcome==='UNKNOWN').length,
    cancelled_n:episodes.filter(x=>x.outcome==='CANCELLED').length,
    timeouts_n:resolved.filter(x=>x.outcome==='TIMEOUT').length,ambiguous_n:resolved.filter(x=>x.ambiguous).length,
    mean_r:n?resolved.reduce((s,x)=>s+x.realized_r,0)/n:null,
    net_r_stress:Object.fromEntries([0,0.02,0.05].map(c=>[String(c),n?resolved.reduce((s,x)=>s+x.realized_r-2*c/x.risk,0)/n:null])),
    cost_note:'Adverse dollars per underlying share per side: scenarios, not measured spreads. Not option returns.'};
}
export function scoreEpisode(bars,index,side,rule,atr,closeAt,delayBars=0){
  const start=index+1+delayBars,decisionAt=Date.parse(bars[index].time)+180000;
  const e={decision_at:new Date(decisionAt).toISOString(),side:side===1?'LONG':'SHORT',
    shadow_only:true,probability:null,entry_delay_bars:delayBars,outcome:'UNKNOWN',ambiguous:false,exit_index:bars.length-1};
  const b=bars[start],expected=decisionAt+delayBars*180000;
  if(expected>=closeAt)return {...e,outcome:'CANCELLED',reason:'No next open before session close',exit_index:index};
  if(!b||Date.parse(b.time)!==expected)return {...e,reason:'Next entry bar missing'};
  const entry=b.open,risk=atr*rule.risk_atr,stop=entry-side*risk,target=entry+side*risk*rule.target_r;
  Object.assign(e,{entry_at:b.time,entry,stop,target,risk});
  const lastExpected=Math.min(closeAt,expected+rule.horizon_bars*180000);
  for(let j=start;j<start+rule.horizon_bars;j++){
    const x=bars[j],want=expected+(j-start)*180000;
    if(want>=closeAt)break;
    if(!x||Date.parse(x.time)!==want)return {...e,reason:'Gap or incomplete outcome horizon'};
    const stopOpen=side*(x.open-stop)<=0,targetOpen=side*(x.open-target)>=0;
    const stopped=side===1?x.low<=stop:x.high>=stop,reached=side===1?x.high>=target:x.low<=target;
    let outcome,exit;
    if(stopOpen){outcome='STOP_FIRST';exit=x.open;}
    else if(targetOpen){outcome='TARGET_FIRST';exit=x.open;}
    else if(stopped){outcome='STOP_FIRST';exit=stop;e.ambiguous ||= reached;}
    else if(reached){outcome='TARGET_FIRST';exit=target;}
    if(outcome)return {...e,outcome,exit,exit_index:j,exit_at:new Date(want+180000).toISOString(),realized_r:side*(exit-entry)/risk};
    if(want+180000>=lastExpected)return {...e,outcome:'TIMEOUT',exit:x.close,exit_index:j,exit_at:new Date(lastExpected).toISOString(),realized_r:side*(x.close-entry)/risk};
  }
  return e;
}
export function replayPolicy(archive,rule,{baseline=false,delayBars=0}={}){
  validateRule(rule);
  const day=archive.session.date,{today,indicators,events,pc,atr}=replaySaty(archive.bars,archive.daily,day);
  const managed=new Map(events.filter(x=>x.kind==='ENTRY'&&x.managed).map(e=>[e.i,e.side]));
  const output=[],closeAt=Date.parse(archive.session.close);let next=0;
  for(let i=0;i<today.length;i++){
    if(i<next)continue;
    let side=0;
    if(baseline||rule.kind==='baseline')side=managed.get(i)??0;
    else {
      const hm=etParts(Date.parse(today[i].time)+180000).hm;
      if(!((hm>='09:35'&&hm<'11:30')||(hm>='15:00'&&hm<'15:30')))continue;
      if(!i||Date.parse(today[i].time)-Date.parse(today[i-1].time)!==180000)continue;
      const c=today[i].close,p=today[i-1].close,e=indicators[i];
      const long=pc+rule.trigger_atr*atr,short=pc-rule.trigger_atr*atr;
      side=p<=long&&c>long?1:p>=short&&c<short?-1:0;
      if(side&&rule.confirmation==='strict'&&!(side*(e.e8-e.e21)>0&&side*(e.e21-e.e34)>0&&side*(e.e13-e.e48)>0))side=0;
      if(side&&rule.confirmation==='relaxed'&&!(side*(e.e13-e.e48)>0))side=0;
    }
    if(!side)continue;
    const result=scoreEpisode(today,i,side,rule,atr,closeAt,delayBars);
    result.id=[SHADOW_VERSION,archive.symbol,day,ruleHash(rule),baseline?'baseline':'challenger',i,delayBars].join('|');
    result.first_observed_at=archive.first_seen?.[today[i].time]??archive.first_received_at;
    result.execution_status='REPLAY_NOT_EXECUTED';result.symbol=archive.symbol;
    output.push(result);next=result.exit_index+1;
  }
  return {episodes:output,summary:summarizeEpisodes(output)};
}
export function evaluateCandidate(candidate,archive){
  const r=validateRule(candidate.rule_set),at=Date.parse(candidate.registered_at),open=Date.parse(archive.session.open);
  if(!Number.isFinite(at)||at>=open)return {status:'NOT_YET_ELIGIBLE',reason:'Rule was not frozen before this session opened'};
  const today=archive.bars.filter(b=>etParts(b.time).day===archive.session.date);
  const close=Date.parse(archive.session.close),expected=(close-open)/180000;
  if(today.length!==expected||today.some((b,i)=>Date.parse(b.time)!==open+i*180000))return {status:'DATA_HOLD',reason:'Incomplete recorded 3m session; no shadow grade or session credit'};
  const baseline=replayPolicy(archive,r,{baseline:true}),shadow=replayPolicy(archive,r),delayed=replayPolicy(archive,r,{delayBars:1});
  const total=episodes=>episodes.filter(x=>Number.isFinite(x.realized_r)).reduce((s,x)=>s+x.realized_r,0);
  return {schema_version:1,status:'EVALUATED',shadow_only:true,probability:null,engine_version:SHADOW_VERSION,
    candidate_id:candidate.candidate_id,rule_hash:ruleHash(r),symbol:archive.symbol,session_date:archive.session.date,
    source_fingerprint:archive.source.feed_fingerprint,recorded_at:archive.last_received_at,
    baseline,shadow,delay_stress:delayed.summary,paired_session_r:total(shadow.episodes)-total(baseline.episodes),
    policy:'Both use next-open entry, registered ATR risk, target R and horizon, with one episode at a time. Baseline ENTRY decisions are unchanged; this outcome policy is a research comparison, not production trade P&L.'};
}
export function promotionStatus(sessions,episodes){
  return {minimum_sessions:30,minimum_episodes:100,sample_floor_met:sessions>=30&&episodes>=100,
    automatic:false,promoted:false,eligible_for_promotion:false,
    reason:'Counts only permit review. Requires registered effect, paired session-cluster uncertainty, cost/delay checks, all guardrails, explicit reviewed PR and rollback. No rule is changed here.'};
}
