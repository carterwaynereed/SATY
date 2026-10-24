// Research observations only. No broker, credentials, journal, or live-rule writes.
import {replaySaty,etParts,SATY_VERSION} from './saty-live.mjs';
import {allocateEvidenceWeights} from '../site/weights.mjs';
const iso=x=>new Date(x).toISOString();
const stack=e=>e[8]>e[21]&&e[21]>e[34]?1:e[8]<e[21]&&e[21]<e[34]?-1:0;
const step=(v,x,n)=>v==null?x:v+2/(n+1)*(x-v);

export function decisionRows(feed, session, observedAt=Date.now()) {
  const now=typeof observedAt==='number'?observedAt:Date.parse(observedAt);
  const bars=feed.bars.filter(b=>Date.parse(b.time)+180000<=now);
  const {today,indicators,events,levels,atr}=replaySaty(bars,feed.daily,session.date);
  const trendBars=(feed.trend_bars??[]).slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  let ti=0,tn=0,lastTrend=null,volume=0,pv=0;const trend={};
  const fingerprint=feed.source?.feed_fingerprint;
  if(!fingerprint)throw Error('Decision ledger requires a verified feed fingerprint');
  return today.map((b,i)=>{
    const at=Date.parse(b.time)+180000, e=indicators[i];
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
    return {schema_version:1,id:[SATY_VERSION,feed.symbol,iso(at),fingerprint].join('|'),
      symbol:feed.symbol,session_date:session.date,bar_open:iso(b.time),time:iso(at),
      observed_at:iso(now),observation_kind:delay<=225?'OBSERVED':'REPLAY_LATE',delay_seconds:Math.round(delay),
      decision:managed?(managed.side===1?'CALL':'PUT'):'WAIT',setup:managed?.setup??null,
      reason:managed?'Frozen baseline emitted a new managed entry':'No new managed baseline entry on this completed bar',
      evidence_score:{call:weights.call,put:weights.put,wait:weights.wait},evidence_kind:'WEIGHTS_NOT_PROBABILITIES',
      row_directions:directions,close:b.close,atr14:atr,source_fingerprint:fingerprint,strategy_version:SATY_VERSION,
      eligible_for_forward_entry_evaluation:false};
  });
}
