// Research observations only. No broker, credentials, journal, or live-rule writes.
import {replaySaty,etParts,SATY_VERSION} from './saty-live.mjs';
import {allocateEvidenceWeights} from '../site/weights.mjs';
import {APPROVED_VERSION,replayApproved,scoreDirection} from '../site/approved-rules.mjs';
import {radarScore} from '../site/radar.mjs';
const iso=x=>new Date(x).toISOString();
const stack=e=>e[8]>e[21]&&e[21]>e[34]?1:e[8]<e[21]&&e[21]<e[34]?-1:0;
const step=(v,x,n)=>v==null?x:v+2/(n+1)*(x-v);

export function policyContext(feed, session, observedAt=Date.now()) {
  const now=typeof observedAt==='number'?observedAt:Date.parse(observedAt);
  const bars=feed.bars.filter(b=>{const p=etParts(b.time),start=Date.parse(b.time);return start+180000<=now&&p.hm>='09:30'&&p.hm<'16:00'&&(p.day<session.date||(start>=Date.parse(session.open)&&start<Date.parse(session.close)));}).slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const {today,indicators,events,levels,atr}=replaySaty(bars,feed.daily,session.date);
  const trendBars=(feed.trend_bars??[]).slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  let ti=0,tn=0,lastTrend=null,volume=0,pv=0;const trend={};
  const fingerprint=feed.source?.feed_fingerprint;
  if(!fingerprint)throw Error('Decision ledger requires a verified feed fingerprint');
  let dayHigh=-Infinity,dayLow=Infinity;
  const warm={widths:[],volumes:[]},ema={};
  for(const b of bars.filter(b=>etParts(b.time).day<session.date).slice(-400)){
    for(const n of [8,34])ema[n]=step(ema[n],b.close,n);
    warm.widths.push(Math.abs(ema[8]-ema[34]));warm.volumes.push(b.volume);
  }
  warm.widths=warm.widths.slice(-50);warm.volumes=warm.volumes.slice(-20);
  const rows=today.map((b,i)=>{
    const at=Date.parse(b.time)+180000, e=indicators[i];dayHigh=Math.max(dayHigh,b.high);dayLow=Math.min(dayLow,b.low);
    while(ti<trendBars.length&&Date.parse(trendBars[ti].time)+600000<=at){
      const t=trendBars[ti++];for(const n of [8,13,21,34,48])trend[n]=step(trend[n],t.close,n);
      tn++;lastTrend=Date.parse(t.time)+600000;
    }
    if(Number.isFinite(b.volume)&&b.volume>0){volume+=b.volume;pv+=(b.high+b.low+b.close)/3*b.volume;}
    const managed=events.find(x=>x.i===i&&x.kind==='ENTRY'&&x.managed===true);
    const directions=[stack({8:e.e8,21:e.e21,34:e.e34}),tn>=60&&at-lastTrend<=645000?stack(trend):0,
      Math.sign(e.e13-e.e48),volume?Math.sign(b.close-pv/volume):0,
      b.close>levels['+23.6']?1:b.close<levels['-23.6']?-1:0,managed?.side??0];
    const weights=allocateEvidenceWeights(directions.map(direction=>({direction})),{fresh:true,inSession:true});
    const delay=(now-at)/1000;
    return {schema_version:1,id:[APPROVED_VERSION,feed.symbol,iso(at),fingerprint].join('|'),
      symbol:feed.symbol,session_date:session.date,bar_open:iso(b.time),time:iso(at),
      observed_at:iso(now),observation_kind:delay<=225?'OBSERVED':'REPLAY_LATE',delay_seconds:Math.round(delay),
      baseline_decision:managed?(managed.side===1?'CALL':'PUT'):'WAIT',setup:managed?.setup??null,
      reason:managed?'Frozen baseline emitted a new managed entry':'No new managed baseline entry on this completed bar',
      evidence_score:{call:weights.call,put:weights.put,wait:weights.wait},evidence_kind:'WEIGHTS_NOT_PROBABILITIES',
      row_directions:directions,evidence_version:SATY_VERSION,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,atr14:atr,source_fingerprint:fingerprint,strategy_version:APPROVED_VERSION,
      score_direction:scoreDirection(weights),et_open:etParts(b.time).hm,et_close:etParts(at).hm,phase:e.po,ema8:e.e8,ema34:e.e34,ribbon3_stop:e.e34,ribbon10_stop:tn>=60&&at-lastTrend<=645000?trend[34]:null,day_high:dayHigh,day_low:dayLow,managed_entry:managed?{side:managed.side,stop:managed.stop,setup:managed.setup}:null,
      eligible_for_forward_entry_evaluation:false};
  });
  const levelList=Object.entries(levels).map(([label,price])=>({label,price,multiple:parseFloat(label)/100}));
  const live=replayApproved(rows,levelList,session,{now,minutes:feed.one_bars??[]});
  const conservative=replayApproved(rows,levelList,session,{now,minutes:feed.one_bars??[],runner:false});
  const byTime=new Map(live.decisions.map(d=>[d.time,d]));
  rows.forEach((r,i)=>{r.radar=radarScore(rows,i,warm);r.approved=byTime.get(r.time)??null;r.decision=r.approved?.decision??'WAIT';r.reason='Approved 60% flip with next-open, session cap and cooldown gates; weights unchanged';});
  return {rows,live,conservative,levels:levelList};
}
export function attachApproved(feed,snapshot,now=Date.now()){
 const p=policyContext(feed,snapshot.session,now),last=p.rows.at(-1);
 // Per-bar decisions belong in the durable ledger, not duplicated twice in UI JSON.
 const {decisions:liveDecisions,...live}=p.live;
 const {decisions:shadowDecisions,...conservative}=p.conservative;
 return {...snapshot,approved_rules:live,conservative_rules:conservative,radar:last?.radar??null};
}
