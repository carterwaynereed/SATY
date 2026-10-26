// Dependency-free port of the frozen sig2 / StrategyPO default bar rules.
// Optional tick-management/experimental PO switches are intentionally not enabled.
import {allocateEvidenceWeights} from '../site/weights.mjs';

export const SATY_VERSION = 'saty-sig-2.0';
const spans = [8,13,21,34,48];
const ratios = {'+200':2,'+161.8':1.618,'+138.2':1.382,'+123.6':1.236,'+100':1,'+78.6':.786,'+61.8':.618,'+50':.5,'+38.2':.382,'+23.6':.236,'0':0,'-23.6':-.236,'-38.2':-.382,'-50':-.5,'-61.8':-.618,'-78.6':-.786,'-100':-1,'-123.6':-1.236,'-138.2':-1.382,'-161.8':-1.618,'-200':-2};
const etFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const etCache=new Map();
export function etParts(time) {const key=typeof time==='number'?time:Date.parse(time);if(etCache.has(key))return etCache.get(key);const p=Object.fromEntries(etFormatter.formatToParts(new Date(key)).map(x=>[x.type,x.value])),value={day:`${p.year}-${p.month}-${p.day}`,hm:`${p.hour}:${p.minute}`};if(etCache.size>=8192)etCache.clear();etCache.set(key,value);return value;}
const iso = t => new Date(t).toISOString();
const step = (old,x,n) => old == null ? x : old+2/(n+1)*(x-old);
const stack = e => e[8]>e[21] && e[21]>e[34] ? 1 : e[8]<e[21] && e[21]<e[34] ? -1 : 0;
const beyond = (x,l,s) => s*(x-l)>0;
const inWindow = hm => hm>='09:35' && hm<'11:30' || hm>='15:00' && hm<'15:30';
const contextWindow = hm => hm>='09:35' && hm<'15:30';
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
const rrBucket = r => r<.5?'<0.5R':r<1?'0.5-1R':r<2?'1-2R':r<4?'2-4R':'>4R';

export function dailyLevels(daily, day) {
  const prior=daily.filter(b=>etParts(b.time).day<day);
  if(prior.length<100)throw new Error('Fewer than 100 completed daily bars for ATR');
  let a=null;
  for(let i=1;i<prior.length;i++){const b=prior[i],p=prior[i-1].close,tr=Math.max(b.high-b.low,Math.abs(b.high-p),Math.abs(b.low-p));a=a==null?tr:a+(tr-a)/14;}
  if(!(a>0))throw new Error('Daily ATR unavailable');
  const pc=prior.at(-1).close;
  return {pc,atr:a,levels:Object.fromEntries(Object.entries(ratios).map(([k,v])=>[k,pc+v*a]))};
}
export function nextLevels(L,side,price,atr,n=3) {
  return Object.entries(L).sort((a,b)=>side*(a[1]-b[1])).filter(([,v])=>side*(v-price)>.05*atr).slice(0,n);
}
class DefaultStrategy {
  constructor(L,atr){this.L=L;this.atr=atr;this.e={};this.pos=null;this.armL=true;this.armS=true;this.ggU=false;this.ggD=false;this.bars=[];this.trs=[];this.widths=[];this.sqn=0;this.range=null;this.pc=null;this.po={pivot:null,smooth:null,atr:null,pc:null,v:null,prev:null};}
  updateEMA(c){for(const n of spans)this.e[n]=step(this.e[n],c,n);}
  phase(b){const p=this.po,tr=p.pc==null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-p.pc),Math.abs(b.low-p.pc));p.pc=b.close;p.atr=p.atr==null?tr:p.atr+(tr-p.atr)/14;p.pivot=step(p.pivot,b.close,21);p.prev=p.v;if(p.atr>0){p.smooth=step(p.smooth,(b.close-p.pivot)/(3*p.atr)*100,3);p.v=p.smooth;}else p.v=0;}
  feed(b){const tr=this.pc==null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-this.pc),Math.abs(b.low-this.pc));this.pc=b.close;this.bars.push(b);this.bars=this.bars.slice(-80);this.trs.push(tr);this.trs=this.trs.slice(-80);this.widths.push(Math.abs(this.e[8]-this.e[34]));this.widths=this.widths.slice(-60);}
  warm(b){this.updateEMA(b.close);this.feed(b);this.phase(b);}
  squeeze(){if(this.bars.length<21)return false;const cl=this.bars.slice(-20).map(b=>b.close),m=mean(cl),sd=Math.sqrt(mean(cl.map(x=>(x-m)**2))),a=mean(this.trs.slice(-20)),w=[...this.widths].sort((x,y)=>x-y);return a>0 && 2*sd<1.5*a && w.length>=30 && this.widths.at(-1)<=w[Math.floor(w.length*.1)];}
  open(side,c,stop,reason){const internal=Object.fromEntries(Object.entries(this.L).filter(([k])=>Math.abs(ratios[k])<=1)),lv=nextLevels(internal,side,c,this.atr,2);const t1=lv[0]?.[1]??c+side*.2*this.atr,t2=lv[1]?.[1]??lv[0]?.[1]??c+side*.3*this.atr;this.pos={side,entry:c,stop,t1,t2,half:false,ribbon_stop:true};return {kind:side===1?'ENTER_LONG':'ENTER_SHORT',reason,price:c};}
  base(hm,b){const {open:o,high:h,low:l,close:c}=b;this.updateEMA(c);const e=this.e,L=this.L,bull=stack(e)===1,bear=stack(e)===-1;let out=[];const p=this.pos;
    if(c>L['+38.2']&&bull)this.ggU=true;if(c<L['-38.2']&&bear)this.ggD=true;
    if(p){const sd=p.side;if(hm>='15:48'){this.pos=null;return [{kind:'EXIT',price:c,reason:'time'}];}
      if(!p.half&&(sd===1?h>=p.t1:l<=p.t1)){p.half=true;if(sd*(p.entry-p.stop)>0)p.stop=p.entry;out.push({kind:'TRIM',price:p.t1,reason:'partial at ATR level'});}
      if(p.t2!==p.t1&&(sd===1?h>=p.t2:l<=p.t2)){out.push({kind:'EXIT',price:p.t2,reason:'target level'});this.pos=null;}
      else if(sd*(c-p.stop)<0||(p.ribbon_stop&&sd*(c-e[34])<0)){out.push({kind:'EXIT',price:c,reason:'stop'});this.pos=null;}
      else if(p.half&&p.t2===p.t1){out.push({kind:'EXIT',price:c,reason:'single target'});this.pos=null;}return out;
    }
    if(c<L['+23.6'])this.armL=true;if(c>L['-23.6'])this.armS=true;if(!inWindow(hm))return out;
    const okL=bull&&e[13]>e[48],okS=bear&&e[13]<e[48];
    if(this.armL&&c>L['+23.6']&&okL&&c>e[8]){this.armL=false;return [this.open(1,c,L['+23.6'],'trigger break')];}
    if(this.armS&&c<L['-23.6']&&okS&&c<e[8]){this.armS=false;return [this.open(-1,c,L['-23.6'],'trigger break')];}
    const touchL=l<=e[8]&&c>e[21]&&c>o,touchS=h>=e[8]&&c<e[21]&&c<o;
    if(this.ggU&&okL&&touchL&&c>L['+23.6'])return [this.open(1,c,e[34],'GG pullback to ribbon')];
    if(this.ggD&&okS&&touchS&&c<L['-23.6'])return [this.open(-1,c,e[34],'GG pullback to ribbon')];
    if(okL&&touchL&&c>L['+23.6'])return [this.open(1,c,e[34],'ribbon re-entry')];
    if(okS&&touchS&&c<L['-23.6'])return [this.open(-1,c,e[34],'ribbon re-entry')];return out;
  }
  onBar(hm,b){this.phase(b);const was=this.sqn,rng=this.range;let out=this.base(hm,b);this.feed(b);const sq=this.squeeze();
    if(!out.length&&!this.pos&&contextWindow(hm)&&was>=3&&rng){if(b.close>rng[0]&&this.e[8]>this.e[21])out=[this.open(1,b.close,rng[1],'squeeze breakout')];else if(b.close<rng[1]&&this.e[8]<this.e[21])out=[this.open(-1,b.close,rng[0],'squeeze breakout')];if(out.length)this.pos.ribbon_stop=false;}
    if(sq){this.sqn++;this.range=rng&&was?[Math.max(b.high,rng[0]),Math.min(b.low,rng[1])]:[b.high,b.low];}else{this.sqn=0;this.range=null;}return out;
  }
}
function cross(today,i,lvl,side){const states=today.slice(0,i+1).map(b=>beyond(b.close,lvl,side)),gap=beyond(today[0].open,lvl,side);let crossings=0,j=null;for(let k=0;k<states.length;k++){if(states[k]&&(k===0?!gap:!states[k-1]))crossings++;if(!states[k])j=k;}if(j==null&&gap)return {event_type:'opening_gap',bars_since_cross:null,crossings};const start=j==null?0:j+1,since=i-start,hm=etParts(today[start].time).hm;return {event_type:since===0?(crossings>1?'recross':'fresh_cross'):hm<'09:35'?'pre_window_cross':'delayed_confirm',bars_since_cross:since,crossings};}
function freshCross(c){return ['fresh_cross','recross'].includes(c.event_type)||c.event_type==='delayed_confirm'&&c.bars_since_cross<=3;}

export function rthSessionBars(bars){return (bars??[]).filter(b=>{const hm=etParts(b.time).hm;return hm>='09:30'&&hm<'16:00';});}
export function replaySaty(bars,daily,day) {
  bars=rthSessionBars(bars);
  const ref=dailyLevels(daily,day),{levels:L,atr}=ref,s=new DefaultStrategy(L,atr),prior=bars.filter(b=>etParts(b.time).day<day).slice(-400),today=bars.filter(b=>etParts(b.time).day===day);
  if(prior.length<400)throw new Error('Fewer than 400 prior RTH 3m warmup bars');
  for(const b of prior)s.warm(b);
  const events=[],indicators=[];let stackPrev=null,lo=Infinity,hi=-Infinity;const gg={'1':{attempt:0,armed:true},'-1':{attempt:0,armed:true}};
  for(let i=0;i<today.length;i++){const b=today[i],hm=etParts(b.time).hm,c=b.close;lo=Math.min(lo,b.low);hi=Math.max(hi,b.high);const had=s.pos?{...s.pos}:null,out=s.onBar(hm,b),decision=iso(Date.parse(b.time)+180000),base={i,bar_open:b.time,decision_time:decision,signal_close:c,sess_low:lo,sess_high:hi};
    indicators.push({...Object.fromEntries(spans.map(n=>['e'+n,s.e[n]])),po:s.po.v,squeeze:s.squeeze()});
    const reached=side=>side===1?hi>=L['+61.8']:lo<=L['-61.8'];
    for(const g of out){if(g.kind.startsWith('ENTER')){const side=g.kind==='ENTER_LONG'?1:-1,p=s.pos,e={...base,kind:'ENTRY',side,setup:g.reason,stop:p.stop,strat_t1:p.t1,strat_t2:p.t2,ribbon_stop:p.ribbon_stop,managed:true};
      if(g.reason==='trigger break'){const lvl=L[side===1?'+23.6':'-23.6'],x=cross(today,i,lvl,side);Object.assign(e,x,{late:reached(side),trigger_level:lvl,cohort:freshCross(x)&&!reached(side)?'fresh':'late/gap',why:`Confirmed close beyond ${side===1?'+':'−'}23.6; ${x.event_type}${reached(side)?'; 61.8 already reached':''}`});}
      else if(g.reason==='GG pullback to ribbon')Object.assign(e,{event_type:'gg_pullback',cohort:reached(side)?'post-GG-dest':'pre-GG-dest',why:`Pullback to 8 EMA held 21 after 38.2 break; 61.8 ${reached(side)?'already':'not yet'} reached`});
      else Object.assign(e,{event_type:g.reason.replaceAll(' ','_'),cohort:'all',why:g.reason});events.push(e);
    }else events.push({...base,kind:'MGMT',side:had?.side??0,setup:had?.setup_name??'',action:g.kind,price:g.price,reason:g.reason});}
    if(s.pos&&out.at(-1)?.kind.startsWith('ENTER'))s.pos.setup_name=out.at(-1).reason;
    const st=stack(s.e),inside=contextWindow(hm);
    if(inside&&stackPrev!==null&&st!==0&&st!==stackPrev){const sw=today.slice(Math.max(0,i-4),i+1),stop=st===1?Math.min(...sw.map(x=>x.low)):Math.max(...sw.map(x=>x.high));if(st*(c-stop)>0)events.push({...base,kind:'ENTRY',side:st,setup:'ribbon flip',stop,context:true,managed:false,event_type:'ribbon_flip',cohort:'all',why:'8/21/34 newly stacked; stop = 5-bar swing'});}
    stackPrev=st;
    for(const side of [1,-1]){const g=gg[side],prefix=side===1?'+':'-',k38=prefix+'38.2',k618=prefix+'61.8',k236=prefix+'23.6';if(!g.armed&&!beyond(c,L[k236],side))g.armed=true;
      if(inside&&g.armed&&beyond(c,L[k38],side)&&!reached(side)&&side*(L[k618]-c)>.05*atr){const x=cross(today,i,L[k38],side);g.armed=false;g.attempt++;events.push({...base,kind:'ENTRY',side,setup:'golden gate open',stop:L[k236],fixed_targets:[k618,prefix+'100'],context:true,managed:false,...x,attempt:g.attempt,cohort:g.attempt===1?(freshCross(x)?'fresh':'late/gap'):'re-attempt',why:`Close beyond 38.2; 61.8 untouched; ${x.event_type}, attempt ${g.attempt}`});}
      else if(g.armed&&inside&&beyond(c,L[k38],side)&&reached(side)&&g.attempt===0){g.armed=false;g.attempt=-1;}
    }
  }
  for(const e of events)if(e.kind==='ENTRY'){e.targets=e.fixed_targets?e.fixed_targets.map(k=>[k,L[k]]):nextLevels(L,e.side,e.signal_close,atr);e.daily_atr=atr;}
  return {...ref,today,indicators,events,strategy:s};
}

export function barrierOutcomes(after,side,entry,stop,targets,complete) {
  const result=targets.map(()=>({outcome:'UNKNOWN',ambiguous:false}));let stopPrice=null,stopAt=null;
  for(let i=0;i<after.length;i++){const b=after[i];if(i>0){if(side*(b.open-stop)<=0){stopPrice=b.open;stopAt=b.time;break;}targets.forEach(([,p],j)=>{if(result[j].outcome==='UNKNOWN'&&side*(b.open-p)>=0)result[j].outcome='TARGET_FIRST';});}
    const hs=side===1?b.low<=stop:b.high>=stop;targets.forEach(([,p],j)=>{if(result[j].outcome!=='UNKNOWN')return;const ht=side===1?b.high>=p:b.low<=p;if(ht&&!hs)result[j].outcome='TARGET_FIRST';else if(ht&&hs)result[j].ambiguous=true;});if(hs){stopPrice=stop;stopAt=b.time;break;}}
  for(const r of result)if(r.outcome==='UNKNOWN')r.outcome=stopAt?'STOP_FIRST':complete?'TIMEOUT':'UNKNOWN';
  return {result,stopPrice,stopAt,lastClose:after.at(-1)?.close??entry};
}
export function targetEvidence(evidence,event,index,rr,source) {
  const bucket=rr>0?rrBucket(rr):null,key=[event.setup,event.cohort,index,bucket].join('|'),cell=(Array.isArray(evidence?.cells)?evidence.cells.find(c=>c.setup===event.setup&&c.cohort===event.cohort&&c.target_index===index&&c.rr_bucket===bucket):evidence?.cells?.[key])??{},n=cell.n??0,hits=cell.hits??0,reasons=[];
  if(!bucket)reasons.push('Next-open entry geometry is not yet available');if(n<20)reasons.push(`Thin exact cell: n=${n}; headline requires n≥20`);
  const fingerprint=source?.feed_fingerprint??source?.fingerprint,expected=evidence?.source?.feed_fingerprint??evidence?.source?.fingerprint;
  if(!fingerprint||fingerprint!==expected)reasons.push('Live and historical feed fingerprints do not match');
  if(!evidence?.built||Date.parse(evidence.built)>Date.parse(event.decision_time))reasons.push('This rebuilt evidence was not available at the original decision');
  if(!evidence?.training_to||evidence.training_to>=etParts(event.decision_time).day)reasons.push('Training cutoff is not before this decision session');
  return {event:`T${index} touched before ORIGINAL stop by session close (16:00 ET)`,evidence:'DEVELOPMENT',display_probability:!reasons.length?hits/n:null,raw_rate:n?hits/n:null,hits,n,sessions:cell.sessions??0,episodes:cell.episodes??n,independent_episodes:null,interval:cell.interval??null,interval_method:'Wilson 95% (descriptive; sessions correlated)',target_index:index,rr_bucket:bucket,cohort_label:[event.setup,event.cohort,'T'+index,bucket??'unavailable R'].join(' / '),reason:reasons.join('; ')||'Development frequency only; not a calibrated prediction',training_end:evidence?.training_to,available_at:evidence?.built,stats_id:evidence?.stats_id,ambiguous:cell.ambiguous??0,timeouts:cell.timeouts??0,target_first_sensitivity:cell.target_first_sensitivity??null,method_notes:['Exact ticker, feed, setup, cohort, target index and reward/risk cell.','Completed 3m bars; unresolved intrabar stop/target ties use stop-first.','Wilson intervals ignore session dependence. No costs, fills or options payoff modeled.']};
}
function displaySignal(e,today,complete,evidence,source,now,symbol){const after=today.slice(e.i+1),entry=after[0]?.open??null,risk=entry!=null?Math.abs(entry-e.stop):null,cancel=entry!=null&&(!e.targets.length||e.side*(entry-e.stop)<=0||e.side*(e.targets[0][1]-entry)<=0),out=entry!=null&&!cancel?barrierOutcomes(after,e.side,entry,e.stop,e.targets,complete):null;
  const status=entry==null?(complete?'EXPIRED':'PENDING_ENTRY'):cancel?'CANCELLED':out.result.some(x=>x.outcome==='UNKNOWN')?'TRACKING':'CLOSED';
  return {id:[SATY_VERSION,symbol,etParts(e.decision_time).day,e.setup,e.cohort,e.side,e.decision_time].join('|'),setup:e.setup,cohort:e.cohort,side:e.side===1?'LONG':'SHORT',kind:e.managed?'managed':'context',decision_at:e.decision_time,bar_at:e.bar_open,observed_at:iso(now),entry_at:after[0]?.time??null,entry,stop:e.stop,risk,risk_atr:risk?risk/e.daily_atr:null,status,eligibility:'CONFIRMED_BAR_REPLAY',eligible_for_forward_entry_evaluation:false,event_type:e.event_type,signal_close:e.signal_close,note:e.why+'; modeled next-open reference, no order or available fill asserted',exit:null,modeled_fixed_t1_r:out?(out.result[0]?.outcome==='TARGET_FIRST'?Math.abs(e.targets[0][1]-entry)/risk:out.result[0]?.outcome==='STOP_FIRST'?e.side*(out.stopPrice-entry)/risk:out.result[0]?.outcome==='TIMEOUT'?e.side*(out.lastClose-entry)/risk:null):null,targets:e.targets.map(([label,price],i)=>{const rr=risk&&!cancel?Math.abs(price-entry)/risk:null;return {label,price,rr,outcome:out?.result[i]?.outcome??'UNKNOWN',ambiguous:out?.result[i]?.ambiguous??false,probability:targetEvidence(evidence,e,i+1,rr,source)};})};}

// Independent 1m availability: never synthesize minute bars from 3m candles.
export function minuteSeries(feed, session, now=Date.now()) {
  const open=Date.parse(session.open), close=Date.parse(session.close);
  const rows=(feed.one_bars??[]).filter(b=>{
    const t=Date.parse(b.time);
    return [b.open,b.high,b.low,b.close].every(Number.isFinite) &&
      b.low<=Math.min(b.open,b.close) && b.high>=Math.max(b.open,b.close) &&
      t>=open && t+60000<=Math.min(close,now) && (t-open)%60000===0;
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const unique=[...new Map(rows.map(b=>[Date.parse(b.time),b])).values()];
  const bars=unique.slice(-120), last=bars.at(-1), asof=last?Date.parse(last.time)+60000:null;
  const current=now>=open&&now<close, age=asof===null?null:(now-asof)/1000;
  const contiguous=bars.every((b,i)=>i===0||Date.parse(b.time)-Date.parse(bars[i-1].time)===60000);
  const state=!bars.length?'UNAVAILABLE':!contiguous?'GAP':current&&age>85?'STALE':current?'CURRENT':'CLOSED';
  return {bars,health:{state,price_asof:asof===null?null:new Date(asof).toISOString(),
    age_seconds:age,ttl_seconds:85,interval:'1m',confirmed:true,contiguous,n:bars.length,
    source:feed.source?.feed_name??feed.source?.symbol??null,
    feed_fingerprint:feed.source?.feed_fingerprint??null,
    reason:state==='UNAVAILABLE'?'Confirmed same-feed 1m history missing; 1m DATA HOLD':
      state==='GAP'?'Gap in confirmed 1m history; 1m DATA HOLD':
      state==='STALE'?'Expected confirmed 1m bar missing; 1m DATA HOLD':
      state==='CLOSED'?'Closed-session 1m reference, not a live signal':'Confirmed same-feed 1m bars'}};
}

export function buildLiveSnapshot(feed,evidence,calendar,now=Date.now()) {
  const time=typeof now==='number'?now:Date.parse(now),clock=etParts(time),sessionBars=rthSessionBars(feed.bars),last=sessionBars.at(-1);
  if(!last)throw new Error('No confirmed regular-session bars returned');
  const day=etParts(last.time).day,sessionRow=calendar.sessions?.[day],todayRow=calendar.sessions?.[clock.day],open=todayRow?.open,close=todayRow?.close,inSession=!!todayRow&&time>=Date.parse(open)&&time<Date.parse(close),firstPending=inSession&&time<Date.parse(open)+180000&&day<clock.day;
  if(!sessionRow)throw new Error('Exchange calendar does not cover the latest bar session');
  const priorBars=sessionBars.filter(b=>etParts(b.time).day<day).slice(-400),todayBars=sessionBars.filter(b=>etParts(b.time).day===day),selected=[...priorBars,...todayBars];
  if(todayBars[0]?.time!==iso(sessionRow.open))throw new Error('Opening 3m bar missing; session replay is incomplete');
  const actual=new Set(selected.map(b=>Date.parse(b.time))),lo=Date.parse(selected[0]?.time),hi=Date.parse(last.time);
  for(const row of Object.values(calendar.sessions))for(let start=Math.max(Date.parse(row.open),lo);start<Date.parse(row.close)&&start<=hi;start+=180000)if(start>=lo&&!actual.has(start))throw new Error('Gap in the prior 400-bar warmup or current RTH session');
  const priorDay=Object.keys(calendar.sessions).filter(d=>d<day).at(-1),lastDaily=feed.daily.filter(b=>etParts(b.time).day<day).at(-1);
  if(priorDay&&etParts(lastDaily?.time).day!==priorDay)throw new Error('Previous completed daily reference is missing');
  const replay=replaySaty(sessionBars,feed.daily,day),{pc,atr,levels:L,today,indicators,events,strategy}=replay,end=indicators.at(-1),asof=Date.parse(last.time)+180000,age=Math.max(0,(time-asof)/1000),fresh=day===clock.day&&age<=225&&!firstPending,complete=asof>=Date.parse(sessionRow.close),state=firstPending?'OPENING':inSession?(fresh?'CURRENT':'STALE'):'CLOSED';
  let cumV=0,cumPV=0;const bars=today.map((b,i)=>{if(Number.isFinite(b.volume)&&b.volume>0){cumV+=b.volume;cumPV+=(b.high+b.low+b.close)/3*b.volume;}const x=indicators[i];return {...b,ema8:x.e8,ema21:x.e21,ema34:x.e34,ema48:x.e48,vwap:cumV?cumPV/cumV:null,phase:x.po};}),vwap=bars.at(-1).vwap;
  const trend={};for(const b of feed.trend_bars??[])for(const n of spans)trend[n]=step(trend[n],b.close,n);
  const trendAge=(asof-Date.parse(feed.trend_bars?.at(-1)?.time)-600000)/1000;
  const e=strategy.e,dir=stack(e),trendReady=(feed.trend_bars?.length??0)>=60&&trendAge<=645,trendDir=trendReady?stack(trend):0,cv=Math.sign(e[13]-e[48]),at=last.close>L['+23.6']?1:last.close<L['-23.6']?-1:0,confirmed=events.filter(x=>x.kind==='ENTRY'&&x.bar_open===last.time&&!x.context).at(-1)?.side??0;
  const fmt=x=>Number(x).toFixed(2),features=[
    {id:'ribbon3',direction:dir,detail:`3m EMA 8 ${fmt(e[8])} / 21 ${fmt(e[21])} / 34 ${fmt(e[34])}`},
    {id:'ribbon10',direction:trendDir,detail:trendReady?`Confirmed 10m EMA 8 ${fmt(trend[8])} / 21 ${fmt(trend[21])} / 34 ${fmt(trend[34])}`:'10m history missing or stale; 25 points neutral'},
    {id:'conviction',direction:cv,detail:`3m EMA 13 ${fmt(e[13])} / 48 ${fmt(e[48])}; RTH basis`},
    {id:'vwap',direction:vwap==null?0:Math.sign(last.close-vwap),detail:vwap==null?'This index feed has no volume; VWAP unavailable, 15 points neutral':`Close ${fmt(last.close)} versus RTH VWAP ${fmt(vwap)}`},
    {id:'atr_trigger',direction:at,detail:`Close versus daily ±23.6 triggers ${fmt(L['-23.6'])} / ${fmt(L['+23.6'])}`},
    {id:'confirmed_trigger',direction:confirmed,detail:confirmed?'Frozen baseline managed entry confirmed on the latest closed 3m bar':'No new managed entry on this confirmed bar; 15 points neutral'},
  ];
  const evidenceWeights={features,fresh,in_session:inSession,...allocateEvidenceWeights(features,{fresh,inSession})},fingerprint=feed.source.feed_fingerprint??feed.source.fingerprint,compatible=!!fingerprint&&fingerprint===(evidence?.source?.feed_fingerprint??evidence?.source?.fingerprint),source={...feed.source,baseline_compatible:compatible},signals=events.filter(e=>e.kind==='ENTRY').map(e=>displaySignal(e,today,complete,evidence,source,time,feed.symbol));
  if(sessionRow.early_close)for(const signal of signals)for(const target of signal.targets){target.probability.display_probability=null;target.probability.reason='Early-close horizon differs from the 16:00 development event. '+target.probability.reason;}
  const minutes=minuteSeries(feed,sessionRow,time);
  const warnings=[];if(!compatible)warnings.push('Development evidence feed fingerprint mismatch; headline rates withheld');if(vwap==null)warnings.push('No index volume; VWAP unavailable');if(day!==clock.day&&!firstPending)warnings.push(`Showing ${day} session reference`);
  return {schema_version:2,generated_at:iso(time),snapshot_id:`${feed.symbol}:${iso(asof)}`,strategy:{version:SATY_VERSION,name:'Saty · frozen baseline port',session_basis:'RTH',notes:['Same default sig2 rules for every ticker. Entry windows remain separate from full-session monitoring.']},session:{date:day,calendar_date:clock.day,status:inSession?'OPEN':'CLOSED',open:sessionRow.open,close:sessionRow.close,timezone:'America/New_York',refresh_seconds:15,early_close:sessionRow.early_close??false},health:{state,reason:firstPending?'Waiting for the first confirmed 09:30–09:33 bar':state==='CURRENT'?'Fresh confirmed TradingView 3m bar':state==='STALE'?'Expected confirmed bar missing; feed lag exceeds 225 seconds':'Regular session closed; final confirmed bars are reference data',price_asof:iso(asof),last_bar_open:iso(last.time),age_seconds:Math.round(age),ttl_seconds:225,history_complete:true,warnings,source,attempts:feed.attempts??[]},market:{symbol:feed.symbol,last:last.close,prev_close:pc,atr14:atr,change:last.close-pc,change_atr:(last.close-pc)/atr,vwap,day_high:Math.max(...today.map(b=>b.high)),day_low:Math.min(...today.map(b=>b.low))},levels:Object.entries(L).map(([label,price])=>({label,multiple:ratios[label],price,distance:price-last.close})),ribbon:{...Object.fromEntries(spans.map(n=>['ema'+n,e[n]])),alignment:dir===1?'BULLISH':dir===-1?'BEARISH':'MIXED',conviction:cv===1?'BULLISH':cv===-1?'BEARISH':'MIXED',price_position:last.close>Math.max(...Object.values(e))?'ABOVE':last.close<Math.min(...Object.values(e))?'BELOW':'INSIDE',phase:end.po,phase_slope:indicators.length>1?end.po-indicators.at(-2).po:null,squeeze:strategy.squeeze(),trend10:trend},bars,one_minute_bars:minutes.bars,one_minute_health:minutes.health,signals,evidence_weights:evidenceWeights,evidence_id:evidence?.stats_id??null,plan:{state:state==='STALE'?'DATA_HOLD':signals.some(s=>s.status==='TRACKING')?'TRACKING':'WAIT',summary:firstPending?'First regular-session bar is forming. Evidence allocation starts on its confirmed close.':`Confirmed-bar ${feed.symbol} context. Entry windows and fixed-barrier replay are separate from directional evidence weights.`,next_conditions:[{label:'Long trigger',price:L['+23.6'],note:'Requires a confirmed baseline setup'},{label:'Short trigger',price:L['-23.6'],note:'Requires a confirmed baseline setup'}],conflicts:warnings},footnotes:['Signal-only; no broker or orders.','TradingView public no-login feed; displayed source metadata and observed bar age determine usability.','CALL/PUT/WAIT are directional evidence weights, never outcome probabilities.','Development target frequencies are exact-cell descriptive counts, with Wilson intervals; no validated forecast.']};
}

export function unavailableSnapshot(symbol,reason,previous=null,now=Date.now(),attempts=[]) {
  const result=previous?JSON.parse(JSON.stringify(previous)):{schema_version:2,market:{symbol,last:null},ribbon:{},bars:[],levels:[],signals:[],strategy:{version:SATY_VERSION},session:{},footnotes:[]};
  result.generated_at=iso(now);result.health={...result.health,state:'UNAVAILABLE',reason,attempts,ttl_seconds:225};result.plan={...result.plan,state:'DATA_HOLD',summary:reason};result.evidence_weights={...(result.evidence_weights??{}),fresh:false,...allocateEvidenceWeights(result.evidence_weights?.features??[],{fresh:false,inSession:false})};return result;
}
