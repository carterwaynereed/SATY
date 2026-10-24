import {v2Gate} from './level-bounce-v2-filters.mjs';
// Frozen isolated copy of live v1 mechanics for v2 research; never hosted/imported by live policy.
import {etParts} from './saty-live.mjs';
export const BOUNCE_VERSION='shadow-level-bounce-v2-1.0';
const finite=Number.isFinite,T=Date.parse,iso=t=>new Date(t).toISOString();
export const LIVE_BASELINE_REPORTED={n:33,win_rate:.70,wilson_95:[.53,.83],return_pct:4.02,profit_factor:1.76,max_drawdown_pct:-1.10,origin:'User-reported five-week OOS walk-forward; not independently reproduced. Not a live win probability.'};
export function bounceReferences(feed,snapshot,calendar){
 const day=snapshot.session.date,prior=(feed.daily??[]).filter(b=>etParts(b.time).day<day).sort((a,b)=>T(a.time)-T(b.time));
 const monday=new Date(day+'T12:00:00Z');monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
 const end=monday.toISOString().slice(0,10);monday.setUTCDate(monday.getUTCDate()-7);const start=monday.toISOString().slice(0,10);
 const week=prior.filter(b=>{const d=etParts(b.time).day;return d>=start&&d<end;}),expected=Object.keys(calendar.sessions??{}).filter(d=>d>=start&&d<end);
 const last=prior.at(-1),previous=Object.keys(calendar.sessions??{}).filter(d=>d<day).sort().at(-1);
 const validWeek=expected.length>0&&expected.every(d=>week.some(b=>etParts(b.time).day===d));
 return {day,prior_day:last&&etParts(last.time).day===previous?{low:last.low,high:last.high}:null,prior_week:validWeek?{low:Math.min(...week.map(b=>b.low)),high:Math.max(...week.map(b=>b.high))}:null};
}
export function overnightReference(feed,session,calendar){
 const day=session.date,prev=Object.keys(calendar.sessions??{}).filter(d=>d<day).sort().at(-1);
 const rows=(feed?.bars??[]).filter(b=>{const p=etParts(b.time);return p.day===prev&&p.hm>='16:00'&&p.hm<'20:00'||p.day===day&&p.hm>='04:00'&&p.hm<'09:30';});
 // Complete observable session, rather than a partial overnight range.
 const times=new Set(rows.map(b=>{const p=etParts(b.time);return p.day+' '+p.hm;}));
 if(![prev+' 16:00',prev+' 19:59',day+' 04:00',day+' 09:29'].every(x=>times.has(x)))return null;
 return {low:Math.min(...rows.map(b=>b.low)),high:Math.max(...rows.map(b=>b.high)),source:feed.source};
}
export function bounceEventGate(day,events,calendar){
 if(!events||day<events.covered_from||day>events.covered_through)return {state:'DATA HOLD',reason:'Event calendar coverage unavailable'};
 if(events.dates[day]?.length)return {state:'SKIP DAY',reason:events.dates[day].join(' / ')};
 // Third-Friday monthly expiry; exchange holiday shifts it to the prior session.
 const d=new Date(day+'T12:00:00Z');d.setUTCDate(1);d.setUTCDate(1+(5-d.getUTCDay()+7)%7+14);
 const friday=d.toISOString().slice(0,10),expiry=Object.keys(calendar.sessions??{}).filter(x=>x<=friday&&x.slice(0,7)===day.slice(0,7)).sort().at(-1);
 return day===expiry?{state:'SKIP DAY',reason:'Monthly OPEX'}:{state:'OK',reason:'No scheduled CPI / PPI / NFP / FOMC or monthly OPEX'};
}
export function bounceVixAt(vix,at,day,calendar){
 const daily=(vix?.daily??[]).filter(b=>etParts(b.time).day<day).sort((a,b)=>T(a.time)-T(b.time)),prev=Object.keys(calendar.sessions??{}).filter(d=>d<day).sort().at(-1);
 if(daily.length<60||daily.some(b=>!finite(b.close))||prev&&etParts(daily.at(-1).time).day!==prev)return null;
 let ema=null;for(const b of daily)ema=ema==null?b.close:ema+2/22*(b.close-ema);
 const b=(vix?.bars??[]).filter(b=>etParts(b.time).day===day&&T(b.time)+180000<=at).sort((a,b)=>T(a.time)-T(b.time)).at(-1);
 if(!b||at-T(b.time)-180000>225000||!finite(b.close)||!(ema>0))return null;
 return {close:b.close,ema21:ema,bar_close:iso(T(b.time)+180000)};
}
export function bounceStart(snapshot,overnight){
 const levels=snapshot.levels??[],lo=levels.find(x=>x.label==='-23.6')?.price,hi=levels.find(x=>x.label==='+23.6')?.price,open=snapshot.bars?.[0]?.open,atr=snapshot.market.atr14;
 return !finite(lo)||!finite(hi)||!overnight||open>=lo&&open<=hi||overnight.high-overnight.low<.35*atr?'10:00':'09:45';
}
export function bounceCandidate(bars,i,{snapshot,reference,overnight,vix,calendar,v2}){
 const r=bars[i],a=bars[i-1],at=T(r.time)+180000,atr=snapshot.market.atr14,day=snapshot.session.date,hm=etParts(at).hm;
 if(!a||T(r.time)-T(a.time)!==180000||hm<bounceStart(snapshot,overnight)||hm>='15:00'||!(atr>0))return null;
 const v=bounceVixAt(vix,at,day,calendar);if(!v)return null;
 for(const side of [1,-1]){
  if(side*(a.close-a.open)<=0||side*(r.close-r.open)<=0||side*(r.close-a.close)<=0||side*(v.ema21-v.close)<=0)continue;
  const levels=[['Prior-day',reference?.prior_day],['Prior-week',reference?.prior_week],['Overnight',overnight]].map(([name,x])=>({label:name+(side===1?' low':' high'),price:x?.[side===1?'low':'high']}));
  const level=levels.find(l=>finite(l.price)&&side*((side===1?a.low:a.high)-l.price)<=.05*atr+1e-10&&side*(a.close-l.price)>0);
  if(level){const filter=v2Gate(side,bars,i,{snapshot,calendar,v2},v);if(filter.allowed)return {side,level,vix:v,v2_filter:filter,decision_at:iso(at),setup_at:a.time};}
 }return null;
}
export function replayBounce(snapshot,{reference=snapshot.bounce_reference,overnight=null,vix=null,events,calendar,v2},{now=Date.now()}={}){
 const session=snapshot.session,day=session.date,open=T(session.open),exitAt=T(session.close)-300000,atr=snapshot.market.atr14;
 const bars=(snapshot.bars??[]).filter(b=>T(b.time)>=open&&T(b.time)+180000<=now).slice().sort((a,b)=>T(a.time)-T(b.time));
 const gate=bounceEventGate(day,events,calendar),trades=[],decisions=[];let position=null,pending=null,cooldown=0,gap=false;
 const close=(price,at,reason)=>{Object.assign(position,{status:'CLOSED',exit:price,exit_at:iso(at),exit_reason:reason,return_pct:position.side*(price-position.entry)/position.entry*100});if(position.return_pct<0)cooldown=at+1800000;position=null;};
 const barrier=(b,at,duration)=>{if(!position)return;const s=position.side;if(s*(b.open-position.stop)<=0)close(b.open,at,'STOP HIT');else if(s*(b.open-position.target.price)>=0)close(b.open,at,'TARGET');else if(s*((s===1?b.low:b.high)-position.stop)<=0)close(position.stop,at+duration,'STOP HIT');else if(s*((s===1?b.high:b.low)-position.target.price)>=0)close(position.target.price,at+duration,'TARGET');};
 for(let i=0;i<bars.length;i++){
  const b=bars[i],at=T(b.time),decision=at+180000;
  if(at!==open+i*180000){gap=true;pending=null;if(position)position.status='UNRESOLVED';break;}
  if(at>=exitAt)break;
  if(pending){if(at===T(pending.decision_at)&&etParts(at).hm<'15:00'){
   let target=b.open+pending.side*.4*atr;
   const cap=snapshot.levels.find(l=>l.label==='-78.6')?.price;
   if(pending.side===-1&&pending.vix.close<20){if(!finite(cap)||cap>=b.open){pending=null;decisions.push({time:iso(at),reason:'WAIT: put cap leaves no target room'});continue;}target=Math.max(target,cap);}
   position={...pending,id:[BOUNCE_VERSION,snapshot.market.symbol,iso(at),pending.side].join('|'),version:BOUNCE_VERSION,setup:'Level Bounce v2',shadow_only:true,eligible_for_execution:false,status:'TRACKING',entry_at:iso(at),entry:b.open,stop:b.open-pending.side*.35*atr,target:{label:'Level Bounce 0.4 ATR',price:target},no_early_cut:true,signal_only:true};trades.push(position);
  }pending=null;}
  if(position&&decision<=exitAt)barrier(b,at,180000);
  if(decision>=exitAt)break;
  const v=bounceVixAt(vix,decision,day,calendar),c=gate.state==='OK'?bounceCandidate(bars,i,{snapshot,reference,overnight,vix,calendar,v2}):null;
  let reason=gate.state!=='OK'?gate.state+': '+gate.reason:!v?'DATA HOLD: VIX unavailable':position?'POSITION OPEN':trades.length>=3?'SESSION CAP':decision<cooldown?'LOSS COOLDOWN':etParts(decision).hm>='15:00'?'No new entries after 3 PM':etParts(decision).hm<bounceStart(snapshot,overnight)?'Waiting for start time':'WAIT';
  if(c&&!position&&trades.length<3&&decision>=cooldown){pending=c;reason='CONFIRMED '+(c.side===1?'CALL':'PUT')+' · next bar open';}
  const audit=v?[1,-1].map(side=>({side,...v2Gate(side,bars,i,{snapshot,calendar,v2},v)})):[];
  if(reason==='WAIT'&&audit.some(g=>g.state==='DATA HOLD'))reason='DATA HOLD: '+audit.filter(g=>g.state==='DATA HOLD').map(g=>g.reason).join('; ');
  decisions.push({time:iso(decision),reason,side:pending?.side??0,v2_filters:audit});
 }
 if(position&&position.status==='TRACKING'&&now>=exitAt){const start=open+Math.floor((exitAt-open)/180000)*180000;let expected=start;
  for(const b of (snapshot.one_minute_bars??[]).filter(b=>T(b.time)>=start&&T(b.time)+60000<=exitAt&&T(b.time)+60000<=now).sort((a,b)=>T(a.time)-T(b.time))){if(T(b.time)!==expected)break;barrier(b,expected,60000);expected+=60000;if(!position)break;if(expected===exitAt)close(b.close,exitAt,'TIME EXIT');}
  if(position)position.time_exit_pending=true;
 }
 const currentVix=bounceVixAt(vix,Math.min(now,T(bars.at(-1)?.time)+180000),day,calendar),last=decisions.at(-1);
 const state=gap||last?.reason?.startsWith('DATA HOLD')||last?.v2_filters?.every(g=>g.state==='DATA HOLD')?'DATA HOLD':gate.state!=='OK'?gate.state:!currentVix?'DATA HOLD':position?.time_exit_pending?'DATA HOLD':'OK';
 return {version:BOUNCE_VERSION,label:'Level Bounce v2',signal_only:true,shadow_only:true,hidden_from_ui:true,eligible_for_execution:false,state,reason:gap?'Missing regular-session bar':gate.state!=='OK'?gate.reason:!currentVix?'Fresh same-day VIX / prior daily EMA21 unavailable':last?.reason??'Waiting for confirmed bars',start_et:bounceStart(snapshot,overnight),overnight_available:!!overnight,gate,vix:currentVix,entries_today:trades.length,cooldown_until:cooldown?iso(cooldown):null,trades,position,pending,decisions,reported:null};
}
