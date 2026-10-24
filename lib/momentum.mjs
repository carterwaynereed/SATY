// A single, causal momentum observation for the whole desk. No broker/orders.
// Thresholds are frozen product rules, not fitted probabilities.
import {etParts} from './saty-live.mjs';

export const MOMENTUM_VERSION = 'saty-momentum-1.0';
export const MOMENTUM_SYMBOLS = Object.freeze(['SPY','SPX','AAPL','GOOGL']);
export const MOMENTUM_REPORTED = Object.freeze({
  n:64, sample_unit:'sessions', timeframe:'5m', win_rate:.56, interval:[.44,.68],
  walk_forward_rate:.58, walk_forward_n:null,
  label:'Carter-reported baseline replay; not this 3m / RVOL-filtered version',
  independently_reproduced:false
});
const T=Date.parse, iso=t=>new Date(t).toISOString(), finite=Number.isFinite;
const BAR_MS=180000, MINUTE_MS=60000;
const barTime=b=>T(b?.time);
const valid=b=>b&&finite(barTime(b))&&[b.open,b.high,b.low,b.close].every(x=>finite(x)&&x>0)&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close);
const sortBars=bars=>[...new Map((bars??[]).filter(valid).map(b=>[barTime(b),b])).values()].sort((a,b)=>barTime(a)-barTime(b));
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};

/** Same clock-time RTH 3m volume against the prior 20 complete sessions.
 * The current/event session is never included. Scheduled early closes lacking
 * the event slot are ineligible; missing data in an eligible session is never
 * replaced by an older convenient observation. SPX callers pass SPY bars
 * explicitly and the proxy is retained in the returned evidence.
 */
function rvolEvaluator(history,calendar,sessionDate,proxySymbol) {
  const session=calendar?.sessions?.[sessionDate];
  const result={value:null,n:0,required_n:20,baseline_volume:null,event_volume:null,proxy_symbol:proxySymbol,state:'DATA HOLD'};
  if(!session)return ()=>({...result,reason:'Session calendar unavailable for relative volume'});
  const mapping=new Map(sortBars(history).map(b=>[barTime(b),b]));
  const prior=Object.entries(calendar.sessions).filter(([day,s])=>day<sessionDate&&T(s.close)<=T(session.open)).sort((a,b)=>T(a[1].open)-T(b[1].open)).map(([,s])=>s);
  // Full-session validation is performed once per ticker/day replay, not on
  // every candidate. Calendar eligibility is slot-specific: a 13:00 close must
  // not prevent a 14:00 event from using 20 previous full-length sessions.
  const completion=new Map();
  const completeFor=s=>{
    if(completion.has(s.open))return completion.get(s.open);
    let complete=true;
    for(let t=T(s.open);t+BAR_MS<=T(s.close);t+=BAR_MS){const b=mapping.get(t);if(!b||!finite(b.volume)||b.volume<0){complete=false;break;}}
    completion.set(s.open,complete);return complete;
  };
  return eventBar=>{
    const at=barTime(eventBar),offset=at-T(session.open),current=mapping.get(at),volumes=[];
    if(!finite(at)||offset<0||offset%BAR_MS||at+BAR_MS>T(session.close))return {...result,reason:'Event is not an aligned regular-session 3m bar'};
    if(!current||!finite(current.volume)||current.volume<0)return {...result,reason:'Same-time volume is unavailable'};
    const eligiblePrior=prior.filter(s=>T(s.open)+offset+BAR_MS<=T(s.close)).slice(-20);
    for(const s of eligiblePrior){const sample=mapping.get(T(s.open)+offset);if(completeFor(s)&&sample&&finite(sample.volume))volumes.push(sample.volume);}
    const evidence={...result,event_volume:current.volume,n:volumes.length};
    if(eligiblePrior.length!==20||volumes.length!==20)return {...evidence,reason:`Same-time relative volume needs 20 complete prior sessions (${volumes.length}/20 available)`};
    const baseline=median(volumes);
    if(!(baseline>0))return {...evidence,reason:'Same-time volume baseline is zero or unavailable'};
    return {...evidence,value:current.volume/baseline,baseline_volume:baseline,state:'OK',reason:proxySymbol?`Same-time ${proxySymbol} volume proxy; median of 20 prior sessions`:'Same-time volume; median of 20 prior sessions'};
  };
}
export function sameTimeRvol(history,eventBar,calendar,{proxySymbol=null}={}) {
  const at=barTime(eventBar),day=finite(at)?etParts(at).day:null;
  return rvolEvaluator(history,calendar,day,proxySymbol)(eventBar);
}

function levelsFor(snapshot){return (snapshot?.levels??[]).filter(l=>finite(l.price)).map(l=>({label:String(l.label),price:l.price})).sort((a,b)=>a.price-b.price);}
function endAt(snapshot){return T(snapshot.session.close)-5*MINUTE_MS;}

export function validMomentumReservation(c){
  if(!c||c.version!==MOMENTUM_VERSION||typeof c.id!=='string'||!c.id||!MOMENTUM_SYMBOLS.includes(c.symbol)||![1,-1].includes(c.side)||!finite(c.atr)||c.atr<=0||!finite(c.defended_level?.price)||c.defended_level.price<=0)return false;
  const at=T(c.entry_at),decision=T(c.decision_at);
  if(!finite(at)||!finite(decision)||at!==decision||etParts(at).day!==c.session_date||etParts(at).hm>='15:00'||c.entry!=null&&(!finite(c.entry)||c.entry<=0))return false;
  if(!Array.isArray(c.levels)||c.levels.some(l=>!finite(l.price)||l.price<=0||typeof l.label!=='string'))return false;
  if(c.target_hit!==undefined&&typeof c.target_hit!=='boolean')return false;
  if(c.state!==undefined&&!['PENDING_ENTRY','TRACKING','CLOSED','UNRESOLVED'].includes(c.state))return false;
  if(c.level_hits!==undefined&&(!Array.isArray(c.level_hits)||c.level_hits.some(l=>!l||typeof l.label!=='string'||!finite(l.price)||l.price<=0||!finite(T(l.at)))))return false;
  if(c.last_price!=null&&(!finite(c.last_price)||c.last_price<=0))return false;
  for(const key of ['last_price_at','target_hit_at'])if(c[key]!=null&&!finite(T(c[key])))return false;
  for(const key of ['mfe_atr','mae_atr','levels_covered'])if(c[key]!==undefined&&(!finite(c[key])||c[key]<0))return false;
  if(c.entry!=null){
    if(c.stop!==undefined&&(!finite(c.stop)||Math.abs(c.stop-(c.entry-c.side*.3*c.atr))>1e-8))return false;
    if(c.target!==undefined&&(!finite(c.target?.price)||Math.abs(c.target.price-(c.entry+c.side*.236*c.atr))>1e-8))return false;
  }
  if(c.structural_stop!==undefined&&(!finite(c.structural_stop?.price)||Math.abs(c.structural_stop.price-(c.defended_level.price-c.side*.1*c.atr))>1e-8))return false;
  if(c.state==='CLOSED'&&(!finite(c.entry)||!finite(c.exit)||!finite(T(c.exit_at))||T(c.exit_at)<at||!finite(c.return_pct)))return false;
  return true;
}

/** Discover only confirmed events, with no EMA/VIX/trend agreement filters.
 * Trigger escapes are first crossings per direction; later trigger retests may
 * qualify after a departure. Pre-market boundaries permit separate retests.
 */
export function momentumCandidates(input,calendar,{now=Date.now(),volumeHistory,proxySymbol=null}={}) {
  const snapshot=input?.snapshot,holds=[],rejected=[],candidates=[];
  if(!snapshot?.session||!(snapshot.market?.atr14>0))return {candidates,rejected,holds:['Daily ATR / regular-session reference unavailable']};
  const session=snapshot.session,open=T(session.open),end=endAt(snapshot),atr=snapshot.market.atr14,symbol=snapshot.market.symbol;
  if(!MOMENTUM_SYMBOLS.includes(symbol)||!calendar?.sessions?.[session.date])return {candidates,rejected,holds:['Ticker / session calendar unavailable']};
  const bars=sortBars(snapshot.bars??input.history).filter(b=>barTime(b)>=open&&barTime(b)+BAR_MS<=Math.min(now,T(session.close)));
  const levels=levelsFor(snapshot),trigger={1:levels.find(l=>l.label==='+23.6')?.price,'-1':levels.find(l=>l.label==='-23.6')?.price};
  const priorVolume=volumeHistory??input.history??[];
  const evaluateRvol=rvolEvaluator(priorVolume,calendar,session.date,proxySymbol);
  const escaped={1:false,'-1':false},retestArmed={1:false,'-1':false},lastBoundaryTouch={1:false,'-1':false};
  const overnight=input.overnight;
  const validPremarket=overnight?.complete===true&&(overnight.session_date??overnight.day)===session.date&&T(overnight.asof)===open&&finite(overnight.low)&&finite(overnight.high)&&overnight.low<=overnight.high&&symbol!=='SPX';
  if(!validPremarket&&symbol!=='SPX')holds.push('Pre-market range unavailable; trigger events can still qualify');
  for(let i=0;i<bars.length;i++){
    const b=bars[i],start=barTime(b),at=start+BAR_MS;
    if(start!==open+i*BAR_MS){holds.push('Missing regular-session bar; later events withheld');break;}
    if(at>now||at>=end||etParts(at).hm>='15:00')break;
    const emit=(setup_id,setup,side,price,label)=>{
      const rvol=evaluateRvol(b);
      const c={id:[MOMENTUM_VERSION,symbol,session.date,setup_id,side,iso(at)].join('|'),version:MOMENTUM_VERSION,symbol,side,direction:side===1?'CALL':'PUT',setup_id,setup,session_date:session.date,decision_at:iso(at),entry_at:iso(at),tracking_deadline:iso(end),signal_close:b.close,atr,defended_level:{label,price},levels,rvol,source_fingerprint:snapshot.health?.source?.feed_fingerprint??snapshot.health?.source?.fingerprint??input.source?.feed_fingerprint??input.source?.fingerprint??null,signal_only:true,modeled:true};
      if(rvol.state!=='OK'){rejected.push({...c,reason:rvol.reason});holds.push(rvol.reason);}
      else if(rvol.value>=1.5)rejected.push({...c,reason:'Skipped: same-time RVOL is 1.5 or higher'});
      else candidates.push(c);
    };
    for(const side of [1,-1]){
      const level=trigger[side],previous=bars[i-1]?.close??b.open;
      if(finite(level)){
        const first=!escaped[side]&&side*(previous-level)<=0&&side*(b.close-level)>0;
        const touch=side*((side===1?b.low:b.high)-level)<=.03*atr&&side*(b.close-level)>0;
        if(first){escaped[side]=true;emit('TRIGGER_ESCAPE','Trigger escape',side,level,side===1?'Call trigger +23.6':'Put trigger −23.6');retestArmed[side]=false;}
        else if(escaped[side]&&retestArmed[side]&&touch){emit('TRIGGER_RETEST','Trigger retest',side,level,side===1?'Call trigger +23.6':'Put trigger −23.6');retestArmed[side]=false;}
        if(escaped[side]&&side*((side===1?b.low:b.high)-level)>.05*atr)retestArmed[side]=true;
      }
      if(validPremarket){
        const price=side===1?overnight.low:overnight.high;
        const touch=side*((side===1?b.low:b.high)-price)<=.03*atr&&side*(b.close-price)>0;
        if(touch&&!lastBoundaryTouch[side])emit(side===1?'PM_LOW_HOLD':'PM_HIGH_REJECTION',side===1?'Pre-market low hold':'Pre-market high rejection',side,price,side===1?'Pre-market low':'Pre-market high');
        lastBoundaryTouch[side]=touch;
      }
    }
  }
  // A narrow pre-market range or a wide candle can support opposite stories.
  // Do not choose a direction by array order in that situation.
  const conflicted=new Set(candidates.filter(c=>candidates.some(other=>other.decision_at===c.decision_at&&other.side!==c.side)).map(c=>c.decision_at));
  if(conflicted.size)holds.push('Conflicting directions on the same confirmed bar; wait for a clearer event');
  const clear=candidates.filter(c=>{if(!conflicted.has(c.decision_at))return true;rejected.push({...c,reason:'Conflicting directions on the same confirmed bar'});return false;});
  return {candidates:clear,rejected,holds:[...new Set(holds)]};
}

/** Manage a frozen event with observed, confirmed bars only. A target touch
 * establishes a momentum win but does not close the observation. Original
 * structural/adverse invalidation or the session deadline ends tracking.
 */
export function manageMomentum(candidate,input,{now=Date.now()}={}) {
  if(!validMomentumReservation(candidate))return {...candidate,state:'UNRESOLVED',status:'DATA HOLD',reason:'Invalid momentum observation; prices and outcomes are withheld'};
  if(candidate.state==='CLOSED')return {...candidate};
  const snapshot=input?.snapshot,atr=candidate.atr,side=candidate.side,start=T(candidate.entry_at);
  if(!snapshot?.session||snapshot.session.date!==candidate.session_date)return {...candidate,state:'UNRESOLVED',status:'DATA HOLD',reason:'The signal session is unavailable; its record is retained'};
  const fingerprint=snapshot.health?.source?.feed_fingerprint??snapshot.health?.source?.fingerprint??input.source?.feed_fingerprint??input.source?.fingerprint??null;
  if(candidate.source_fingerprint&&candidate.source_fingerprint!==fingerprint)return {...candidate,state:'UNRESOLVED',status:'DATA HOLD',reason:'The price source changed; the original signal record is retained'};
  const end=endAt(snapshot),open=T(snapshot.session.open),cap=Math.min(now,end);
  const three=sortBars(snapshot.bars??input.history).filter(b=>barTime(b)>=start&&barTime(b)+BAR_MS<=cap);
  const minute=sortBars(input.one_bars??snapshot.one_minute_bars).filter(b=>barTime(b)>=start&&barTime(b)+MINUTE_MS<=cap);
  const threeMap=new Map(three.map(b=>[barTime(b),b])),minuteMap=new Map(minute.map(b=>[barTime(b),b]));
  const first=minuteMap.get(start)??threeMap.get(start),entry=finite(candidate.entry)?candidate.entry:first?.open??null;
  const base={...candidate,entry,tracking_deadline:iso(end),state:'PENDING_ENTRY',status:'WAIT',reason:'Confirmed setup; waiting for the next bar’s observed open',target_hit:candidate.target_hit===true,target_hit_at:candidate.target_hit_at??null,mfe_atr:candidate.mfe_atr??0,mae_atr:candidate.mae_atr??0,levels_covered:candidate.levels_covered??0,level_hits:(candidate.level_hits??[]).map(l=>({...l})),last_price:candidate.last_price??entry,last_price_at:candidate.last_price_at??null};
  if(!finite(entry)){
    if([...three,...minute].some(b=>barTime(b)>start)||now>=end)return {...base,state:'UNRESOLVED',status:'DATA HOLD',reason:'Next-bar open is missing; no entry price invented'};
    return base;
  }
  const p={...base,state:'TRACKING',status:'HOLD',stop:entry-side*.3*atr,structural_stop:{label:'Confirmed close beyond the defended level by 0.1 ATR',price:candidate.defended_level.price-side*.1*atr},target:{label:'+0.236 ATR',price:entry+side*.236*atr},next_level:(candidate.levels??[]).filter(l=>side*(l.price-entry)>1e-10).sort((a,b)=>side*(a.price-b.price))[0]??null,reason:'Momentum is holding. Watch the next Saty level.'};
  const close=(price,at,reason)=>Object.assign(p,{state:'CLOSED',status:'EXIT',reason,exit_reason:reason,exit:price,exit_at:iso(at),return_pct:side*(price/entry-1)*100});
  const mark=(price,at)=>{
    p.mfe_atr=Math.max(p.mfe_atr,side*(price-entry)/atr,0);
    const keys=new Set(p.level_hits.map(l=>l.label));
    for(const l of candidate.levels??[])if(side*(l.price-entry)>1e-10&&side*(price-l.price)>=-1e-10&&!keys.has(l.label)){p.level_hits.push({...l,at:iso(at)});keys.add(l.label);}
    p.levels_covered=p.level_hits.length;
    if(!p.target_hit&&side*(price-p.target.price)>=-1e-10){p.target_hit=true;p.target_hit_at=iso(at);}
  };
  const step=(b,time,duration,structuralClose)=>{
    if(p.state!=='TRACKING')return;
    const finish=time+duration;
    if(side*(b.open-p.stop)<=0){p.mae_atr=Math.max(p.mae_atr,side*(entry-b.open)/atr);close(b.open,time,'Stop hit: price moved 0.3 ATR against the signal.');return;}
    // An opening gap through the milestone has unambiguous ordering.
    mark(b.open,time);
    const adverse=side===1?b.low:b.high,favourable=side===1?b.high:b.low;
    p.mae_atr=Math.max(p.mae_atr,side*(entry-adverse)/atr,0);
    if(side*(adverse-p.stop)<=0){
      if(!p.target_hit&&side*(favourable-p.target.price)>=0)p.ambiguous=true;
      close(p.stop,finish,'Stop hit: price moved 0.3 ATR against the signal.');return;
    }
    mark(favourable,finish);
    p.last_price=b.close;p.last_price_at=iso(finish);
    if(structuralClose&&side*(b.close-p.structural_stop.price)<0)close(b.close,finish,'Exit: a confirmed close lost the defended level by more than 0.1 ATR.');
  };
  let expected=start;
  while(expected<cap&&p.state==='TRACKING'){
    const b3=threeMap.get(expected),minutes=[0,1,2].map(i=>minuteMap.get(expected+i*MINUTE_MS));
    if(b3&&minutes.every(Boolean)){
      for(let i=0;i<3&&p.state==='TRACKING';i++)step(minutes[i],expected+i*MINUTE_MS,MINUTE_MS,i===2);
      expected+=BAR_MS;
    }else if(b3){step(b3,expected,BAR_MS,true);expected+=BAR_MS;}
    else if(minuteMap.has(expected)){
      const b=minuteMap.get(expected),confirmed3m=(expected+MINUTE_MS-open)%BAR_MS===0;
      step(b,expected,MINUTE_MS,confirmed3m);expected+=MINUTE_MS;
    }else break;
  }
  if(p.state==='TRACKING'&&expected<cap){
    const later=[...three,...minute].some(b=>barTime(b)>expected);
    if(later||now>=end){p.state='UNRESOLVED';p.status='DATA HOLD';p.reason=now>=end?'The exact time-exit bar is missing; outcome remains unresolved.':'Missing price bars; the signal is retained without guessing its outcome.';}
  }
  if(p.state==='TRACKING'&&now>=end&&expected===end)close(p.last_price,end,'Exit: session tracking ends five minutes before the close.');
  const reached=new Set(p.level_hits.map(l=>l.label));
  p.next_level=(candidate.levels??[]).filter(l=>side*(l.price-entry)>1e-10&&!reached.has(l.label)).sort((a,b)=>side*(a.price-b.price))[0]??null;
  if(p.state==='TRACKING'){
    const stopDistance=side*(p.last_price-p.structural_stop.price)/atr,adverseDistance=side*(p.last_price-p.stop)/atr,targetDistance=side*(p.target.price-p.last_price)/atr;
    if(stopDistance<=.05||adverseDistance<=.05||!p.target_hit&&targetDistance>=0&&targetDistance<=.05){p.status='GET READY TO EXIT';p.reason=adverseDistance<=.05?'Watch closely: price is near the 0.3 ATR adverse stop.':stopDistance<=.05?'Watch closely: price is near the defended level.':'The +0.236 ATR milestone is close. Watch for a reversal; this alert does not call for profit-taking.';}
    else if(p.target_hit)p.reason='Momentum target reached. Keep tracking while the defended level holds.';
  }
  return p;
}

export function momentumStats(signals=[]) {
  const unique=[...new Map(signals.filter(Boolean).map(x=>[x.id,x])).values()];
  const resolved=unique.filter(x=>x.target_hit===true||x.state==='CLOSED'),n=resolved.length,wins=resolved.filter(x=>x.target_hit===true).length;
  const closed=unique.filter(x=>x.state==='CLOSED'&&finite(x.return_pct)),green=closed.filter(x=>x.return_pct>0).length;
  const profits=closed.reduce((s,x)=>s+Math.max(0,x.return_pct),0),losses=-closed.reduce((s,x)=>s+Math.min(0,x.return_pct),0);
  let interval=null;
  if(n){const z=1.95996398454,p=wins/n,den=1+z*z/n,centre=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;interval=[centre-half,centre+half];}
  return {n,wins,win_rate:n>=20?wins/n:null,target_hit_rate:n>=20?wins/n:null,raw_rate:n?wins/n:null,interval,closed_n:closed.length,closed_green:green,closed_green_rate:closed.length>=20?green/closed.length:null,profit_factor:losses>0?profits/losses:null,unresolved:unique.length-resolved.length,version:MOMENTUM_VERSION};
}

/** First qualifying event in chronological order across all four tickers.
 * A durable reservation wins over any later/backfilled candidate forever.
 * entryAfter is supplied by the live reader; Infinity prevents any new alert.
 */
export function replayMomentum(inputs,calendar,{now=Date.now(),sessionDate=null,reservation=null,entryAfter=null}={}) {
  const day=sessionDate??Object.values(inputs??{}).map(x=>x.snapshot?.session?.date).filter(Boolean).sort().at(-1);
  const candidates=[],rejected=[],holds=[];
  for(const symbol of MOMENTUM_SYMBOLS){
    const input=inputs?.[symbol];if(input?.snapshot?.session?.date!==day)continue;
    const found=momentumCandidates(input,calendar,{now,volumeHistory:symbol==='SPX'?(inputs.SPY?.history??[]):input.history,proxySymbol:symbol==='SPX'?'SPY':null});
    candidates.push(...found.candidates);rejected.push(...found.rejected);holds.push(...found.holds.map(reason=>`${symbol}: ${reason}`));
  }
  const order=(a,b)=>T(a.decision_at)-T(b.decision_at)||MOMENTUM_SYMBOLS.indexOf(a.symbol)-MOMENTUM_SYMBOLS.indexOf(b.symbol)||({TRIGGER_ESCAPE:0,TRIGGER_RETEST:1,PM_LOW_HOLD:2,PM_HIGH_REJECTION:3}[a.setup_id]??9)-({TRIGGER_ESCAPE:0,TRIGGER_RETEST:1,PM_LOW_HOLD:2,PM_HIGH_REJECTION:3}[b.setup_id]??9)||a.id.localeCompare(b.id);
  candidates.sort(order);
  const eligible=candidates.filter(c=>{
    if(entryAfter!=null&&T(c.entry_at)<entryAfter){rejected.push({...c,reason:'Earlier replay event; no retroactive alert'});return false;}return true;
  });
  const retained=reservation?.session_date===day?reservation:null,selected=retained??eligible[0]??null;
  const signal=selected?manageMomentum(selected,inputs[selected.symbol],{now}):null;
  const others=eligible.filter(c=>c.id!==selected?.id&&(!selected||T(c.decision_at)>=T(selected.decision_at)));
  const second=selected?others[0]??null:null;
  for(const c of others)rejected.push({...c,reason:'One signal already selected for this session'});
  return {version:MOMENTUM_VERSION,session_date:day??null,signal,second_signal:second?{...second,watch_only:true,lower_confidence:true,label:'Second signal (lower confidence)',reason:'Research watch only; the daily live signal has already been used.'}:null,candidates,rejected,holds:[...new Set(holds)],stats:momentumStats(signal?[signal]:[]),_reservation:signal,reported:MOMENTUM_REPORTED,signal_only:true,max_signals_per_day:1};
}
