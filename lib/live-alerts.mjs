import {etParts} from './saty-live.mjs';
import {bounceEventGate} from './level-bounce.mjs';
import {outcomeStats,ALERT_PROFILES} from '../site/outcome-stats.mjs';
export const ALERT_VERSION='saty-live-alert-desk-1.0';
const T=Date.parse,iso=t=>new Date(t).toISOString(),finite=Number.isFinite;
export function intervalRows(feed,minutes,calendar){let ema=null,n=0;return (feed?.bars??[]).slice().sort((a,b)=>T(a.time)-T(b.time)).flatMap(b=>{const s=calendar.sessions?.[etParts(b.time).day],start=T(b.time);if(!s||start<T(s.open)||start>=T(s.close)||(start-T(s.open))%(minutes*60000))return [];ema=ema==null?b.close:ema+2/22*(b.close-ema);return [{...b,ema21:ema,n:++n,known_at:iso(Math.min(start+minutes*60000,T(s.close)))}];});}
export function intervalAt(rows,minutes,calendar,at){const r=rows.filter(r=>T(r.known_at)<=at).at(-1);if(!r||r.n<60)return null;let expected=-Infinity;for(const s of Object.values(calendar.sessions??{})){if(T(s.open)>at)continue;for(let t=T(s.open);t<T(s.close);t+=minutes*60000){const end=Math.min(t+minutes*60000,T(s.close));if(end<=at)expected=Math.max(expected,end);}}if(T(r.known_at)!==expected)return null;const known=rows.filter(r=>T(r.known_at)<=at).slice(-60),start=T(known[0].time),actual=new Set(known.map(r=>T(r.time)));for(const s of Object.values(calendar.sessions??{}))for(let t=Math.max(start,T(s.open));t<T(s.close)&&t<at;t+=minutes*60000)if(Math.min(t+minutes*60000,T(s.close))<=at&&!actual.has(t))return null;return r;}
export function setupCandidates(snapshot,{overnight,vix,hour,vix15,calendar,events},now=Date.now()){
 const bars=snapshot.bars??[],atr=snapshot.market?.atr14,session=snapshot.session,open=T(session.open),end=T(session.close)-300000,out=[],holds=[];
 if(!(atr>0)||bounceEventGate(session.date,events,calendar).state!=='OK')return {candidates:[],holds:['Event calendar / data-day gate']};
 const lower=snapshot.levels.find(l=>l.label==='-23.6')?.price,upper=snapshot.levels.find(l=>l.label==='+23.6')?.price,box=bars[0]?.open>=lower&&bars[0]?.open<=upper;
 const morning=bars.filter(b=>T(b.time)>=open&&T(b.time)+180000<=open+3600000),morningReady=morning.length===20&&morning.every((b,i)=>T(b.time)===open+i*180000),morningHigh=morningReady?Math.max(...morning.map(b=>b.high)):null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],at=T(b.time)+180000,previous=bars[i-1];if(at>now||at>=end||etParts(at).hm>='15:00')break;
  if(T(b.time)!==open+i*180000){holds.push('Incomplete 3m session');break;}
  const emit=(setup_id,level,context={})=>out.push({id:[ALERT_VERSION,setup_id,snapshot.market.symbol,iso(at)].join('|'),setup_id,symbol:snapshot.market.symbol,side:ALERT_PROFILES[setup_id].side,decision_at:iso(at),entry_at:iso(at),level,context});
  if(overnight&&b.low<=overnight.low+.05*atr&&b.close>overnight.low&&(!previous||previous.low>overnight.low+.05*atr||previous.close<=overnight.low)){
   const v=(vix?.bars??[]).filter(x=>etParts(x.time).day===session.date&&T(x.time)+180000<=at).at(-1),m=intervalAt(vix15??[],15,calendar,at);
   if(!v||at-T(v.time)-180000>225000||!m)holds.push('ON-Low: VIX / confirmed 15m EMA DATA HOLD');else if(v.close<m.ema21)emit('ON_LOW',{label:'Overnight low',price:overnight.low},{vix:v.close,vix15_ema21:m.ema21});
  }
  if(morningReady&&at>open+3600000&&b.high>=morningHigh-.05*atr&&b.close<morningHigh&&(!previous||previous.high<morningHigh-.05*atr||previous.close>=morningHigh)){
   const h=intervalAt(hour??[],60,calendar,at);if(!h)holds.push('Morning High: confirmed 1H EMA DATA HOLD');else if(h.close<h.ema21)emit('MORNING_HIGH',{label:'First-hour high',price:morningHigh},{hour_at:h.known_at,hour_close:h.close,hour_ema21:h.ema21});
  }
  if(box&&b.close>upper&&(previous?.close??bars[0].open)<=upper)emit('BOX_BREAK',{label:'Call trigger +23.6',price:upper});
 }
 if(!overnight)holds.push('ON-Low: overnight unavailable (SPX has no extended session)');
 return {candidates:out,holds:[...new Set(holds)]};
}
export function manageAlert(candidate,snapshot,now=Date.now()){
 const start=T(candidate.entry_at),atr=snapshot.market.atr14,side=candidate.side,end=T(snapshot.session.close)-300000,bars=snapshot.bars.filter(b=>T(b.time)>=start&&T(b.time)+180000<=Math.min(now,end));
 const first=bars[0],base={...candidate,version:ALERT_VERSION,setup:ALERT_PROFILES[candidate.setup_id].label,signal_only:true,modeled:true,status:'PENDING_ENTRY',target_hit:false,first_scale_hit:false};
 if(!first||T(first.time)!==start)return first?{...base,status:'UNRESOLVED',exit_reason:'Missing next entry bar'}:base;
 const p={...base,status:'TRACKING',entry:first.open,stop:first.open-side*.35*atr,original_stop:first.open-side*.35*atr,target:{label:'0.4 ATR target',price:first.open+side*.4*atr},scale:{label:'0.3 ATR first scale (half)',price:first.open+side*.3*atr},remaining:1,realized_pct:0};
 const close=(price,at,reason)=>{Object.assign(p,{status:'CLOSED',exit:price,exit_at:iso(at),exit_reason:reason,return_pct:p.realized_pct+p.remaining*side*(price/p.entry-1)*100});p.remaining=0;};
 const step=(b,at,duration)=>{
  if(p.status!=='TRACKING')return;
  if(side*(b.open-p.stop)<=0){close(b.open,at,'STOP HIT');return;}
  if(side*(b.open-p.target.price)>=0){p.target_hit=true;if(!p.first_scale_hit){p.first_scale_hit=true;p.remaining=.5;p.realized_pct=.5*side*(p.scale.price/p.entry-1)*100;}close(b.open,at,'TARGET');return;}
  if(side*((side===1?b.low:b.high)-p.stop)<=0){close(p.stop,at+duration,'STOP HIT');return;}
  if(!p.first_scale_hit&&side*((side===1?b.high:b.low)-p.scale.price)>=0){p.first_scale_hit=true;p.remaining=.5;p.realized_pct=.5*side*(p.scale.price/p.entry-1)*100;p.scale_at=iso(at+duration);}
  if(side*((side===1?b.high:b.low)-p.target.price)>=0){p.target_hit=true;close(side*(b.open-p.target.price)>=0?b.open:p.target.price,at+duration,'TARGET');return;}
  if(p.first_scale_hit){const trail=b.close-side*.35*atr;p.stop=side===1?Math.max(p.stop,trail):Math.min(p.stop,trail);p.trail=true;}
 };
 let expected=start;
 for(const b of bars){if(T(b.time)!==expected){p.status='UNRESOLVED';p.exit_reason='Missing 3m bar';break;}step(b,expected,180000);expected+=180000;if(p.status==='CLOSED')break;}
 if(p.status==='TRACKING'&&now>=end){for(const b of (snapshot.one_minute_bars??[]).filter(b=>T(b.time)>=expected&&T(b.time)+60000<=end&&T(b.time)+60000<=now).sort((a,b)=>T(a.time)-T(b.time))){if(T(b.time)!==expected)break;step(b,expected,60000);expected+=60000;if(p.status==='CLOSED')break;if(expected===end)close(b.close,end,'TIME EXIT');}if(p.status==='TRACKING')p.time_exit_pending=true;}
 return p;
}
export function admitAlerts(candidates,{now=Date.now(),reservations=[]}={}){
 const accepted=[],rejected=[],tickerCount={},cooldowns={},positions={},seen=new Set();
 const reserved=reservations.map(t=>candidates.find(c=>c.id===t.id)??{...t,status:'UNRESOLVED',exit_at:null});
 const floor=reserved.length?Math.max(...reserved.map(t=>T(t.decision_at))):-Infinity;
 const sorted=candidates.filter(c=>T(c.decision_at)<=now&&etParts(c.entry_at).hm<'15:00').slice().sort((a,b)=>T(a.decision_at)-T(b.decision_at)||(ALERT_PROFILES[b.setup_id]?.rank??0)-(ALERT_PROFILES[a.setup_id]?.rank??0)||(ALERT_PROFILES[b.setup_id]?.reported.profit_factor??0)-(ALERT_PROFILES[a.setup_id]?.reported.profit_factor??0)||a.symbol.localeCompare(b.symbol)||a.id.localeCompare(b.id));
 const ordered=[...reserved.sort((a,b)=>T(a.decision_at)-T(b.decision_at)),...sorted.filter(c=>!reserved.some(t=>t.id===c.id))];
 for(const c of ordered){if(seen.has(c.id))continue;seen.add(c.id);const at=T(c.entry_at),prior=positions[c.symbol];if(prior&&T(prior.exit_at)<=at){if(prior.return_pct<0)cooldowns[c.symbol]=T(prior.exit_at)+1800000;delete positions[c.symbol];}
  const reason=!reserved.some(t=>t.id===c.id)&&T(c.decision_at)<floor?'Replay-late candidate; no retroactive alert':accepted.length>=5?'Daily total 5 reached':(tickerCount[c.symbol]??0)>=3?'Ticker total 3 reached':positions[c.symbol]?'One position per ticker':at<(cooldowns[c.symbol]??0)?'30-minute loss cooldown':null;
  if(reason){rejected.push({id:c.id,symbol:c.symbol,setup_id:c.setup_id,decision_at:c.decision_at,reason});continue;}
  accepted.push(c);tickerCount[c.symbol]=(tickerCount[c.symbol]??0)+1;positions[c.symbol]=c;
 }
 for(const [symbol,t] of Object.entries(positions))if(T(t.exit_at)<=now&&t.return_pct<0)cooldowns[symbol]=T(t.exit_at)+1800000;
 return {accepted,rejected,total:accepted.length,ticker_count:tickerCount,cooldowns,goal:'Aim for 1–2 best qualified setups; never force an alert.',limits:'Hard max 5 total / 3 per ticker; 30-minute loss cooldown; no new entries after 3 PM'};
}
export function replayAlertDesk(bundle,context,aux,calendar,events,now=Date.now(),reservations=[]){
 const candidates=[],holds={},sessionDate=Object.values(bundle.symbols??{}).map(s=>s.session?.date).filter(Boolean).sort().at(-1);
 for(const [symbol,s] of Object.entries(bundle.symbols??{})){
  if(s.session?.date!==sessionDate||!s.market?.atr14)continue;
  const matching=(a,b)=>!a?.source_id||!b?.source_id||a.source_id===b.source_id;const v15=matching(aux.vix15?.source,context.vix?.source)?intervalRows(aux.vix15,15,calendar):[],hour=matching(aux.hours?.[symbol]?.source,s.health?.source)?intervalRows(aux.hours?.[symbol],60,calendar):[],x=setupCandidates(s,{overnight:context.overnight?.[symbol],vix:context.vix,vix15:v15,hour,calendar,events},now);holds[symbol]=x.holds;
  candidates.push(...x.candidates.map(c=>manageAlert(c,s,now)));
  for(const [field,setup_id] of [['approved_rules','MAIN'],['level_bounce','LEVEL_BOUNCE']]){
   const p=s[field];for(const t of p?.trades??[])candidates.push({...t,setup_id,symbol,id:[setup_id,symbol,iso(T(t.decision_at))].join('|')});
   if(p?.pending){const t=p.pending,at=t.decision_at??iso(t.at);candidates.push({...t,id:[setup_id,symbol,iso(T(at))].join('|'),decision_at:at,entry_at:at,status:'PENDING_ENTRY',setup_id,symbol});}
  }
 }
 const result=admitAlerts(candidates,{now,reservations}),symbols={};
 for(const [symbol,s] of Object.entries(bundle.symbols??{})){
  const own=result.accepted.filter(t=>t.symbol===symbol),fields={};
  for(const [field,id] of [['approved_rules','MAIN'],['level_bounce','LEVEL_BOUNCE']])if(s[field]){const ts=own.filter(t=>t.setup_id===id),pending=ts.find(t=>t.status==='PENDING_ENTRY');fields[field]={...s[field],trades:ts.filter(t=>t.status!=='PENDING_ENTRY'),position:ts.find(t=>t.status==='TRACKING')??null,pending:pending??null,entries_today:ts.length,realized_net_pct:ts.filter(t=>t.status==='CLOSED').reduce((sum,t)=>sum+(t.return_pct??0),0),last_event:ts.length?{kind:ts.at(-1).status==='CLOSED'?'EXIT':ts.at(-1).status==='PENDING_ENTRY'?'CONFIRMED':'ENTRY',time:ts.at(-1).exit_at??ts.at(-1).entry_at,setup_id:id}:null,cooldown_until:result.cooldowns[symbol]?iso(result.cooldowns[symbol]):null,shared_limits:true,fourth_entry_eligible:false,...(!ts.length&&(s[field].position||s[field].pending)?{reason:result.rejected.find(t=>t.symbol===symbol&&t.setup_id===id)?.reason??'Shared daily alert gate'}:{})};}
  const trades=own.filter(t=>!['MAIN','LEVEL_BOUNCE'].includes(t.setup_id));symbols[symbol]={...s,...fields,live_alerts:{version:ALERT_VERSION,trades,holds:holds[symbol]??[],stats:outcomeStats(trades),global_total:result.total,ticker_total:result.ticker_count[symbol]??0,limits:result.limits,rejected:result.rejected.filter(t=>t.symbol===symbol)}};
 }
 return {...bundle,symbols,_reservations:result.accepted,alert_budget:{version:ALERT_VERSION,session_date:sessionDate,total:result.total,ticker_count:result.ticker_count,limits:result.limits,goal:result.goal,signal_only:true}};
}
