// Isolated research only; never imported by the hosted app or live policy.
import {etParts,replaySaty} from './saty-live.mjs';
import {retestStats} from './trigger-retest-shadow.mjs';
export const VERSION='saty-21-pullback-vix-1.0';
const stamp=Date.parse, iso=t=>new Date(t).toISOString();
export function shadowRows(feed,session){
 const bars=feed.bars.slice().sort((a,b)=>stamp(a.time)-stamp(b.time));
 const p=replaySaty(bars,feed.daily,session.date);
 let ema=null;const history=[];for(const b of bars.filter(b=>etParts(b.time).day<session.date).slice(-400)){ema=ema==null?b.close:ema+(b.close-ema)*2/22;history.push(ema);}
 const rows=p.today.map((b,i)=>{const past=history.at(-5);history.push(p.indicators[i].e21);return {...b,symbol:feed.symbol,bar_open:b.time,time:iso(stamp(b.time)+180000),ema21:p.indicators[i].e21,ema21_5ago:past,ema34:p.indicators[i].e34,atr:p.atr};});return {levels:p.levels,rows};
}
export function startTime(rows,levels,overnight){
 const atr=rows[0]?.atr,open=rows[0]?.open;
 const inside=Number.isFinite(open)&&open>=levels['-23.6']&&open<=levels['+23.6'];
 // Unknown overnight context cannot prove eligibility for the early start.
 const valid=Number.isFinite(overnight?.high)&&Number.isFinite(overnight?.low)&&overnight.high>=overnight.low;
 return inside||!valid||overnight.high-overnight.low<.35*atr?'10:00':'09:45';
}
export function vixAt(vix,at,day){
 const daily=(vix?.daily??[]).filter(b=>etParts(b.time).day<day).sort((a,b)=>stamp(a.time)-stamp(b.time));
 if(daily.length<60||daily.some(b=>!Number.isFinite(b.close)))return null;
 let ema=null;for(const b of daily)ema=ema==null?b.close:ema+(b.close-ema)*2/22;
 const b=(vix.bars??[]).filter(b=>etParts(b.time).day===day&&stamp(b.time)+180000<=at).sort((a,b)=>stamp(a.time)-stamp(b.time)).at(-1);
 if(!b||at-stamp(b.time)-180000>225000||!Number.isFinite(b.close)||!(ema>0))return null;
 return {close:b.close,ema21:ema,bar_close:iso(stamp(b.time)+180000)};
}
export function candidate(rows,i,{levels,overnight,vix,session}){
 const r=rows[i],p=rows[i-5],at=stamp(r.time),hm=etParts(at).hm;
 const past=Number.isFinite(r.ema21_5ago)?r.ema21_5ago:p&&stamp(r.bar_open)-stamp(p.bar_open)===900000?p.ema21:null;
 if(!Number.isFinite(past)||hm<startTime(rows,levels,overnight)||hm>='15:00'||!(r.atr>0))return null;
 const v=vixAt(vix,at,session.date);if(!v)return null;
 for(const side of [1,-1])if(side*(r.ema21-past)>0&&side*(r.close-r.ema21)>0&&side*(r.close-r.ema34)>0&&(side===1?r.low<=r.ema21:r.high>=r.ema21)&&side*(v.ema21-v.close)>0)return {side,vix:v};
 return null;
}
export function replayPullback(rows,context,{now=Date.now(),minutes=[]}={}){
 const {session}=context,exitAt=stamp(session.close)-300000;
 // Exchange close minus five minutes handles DST and early closes.
 const trades=[],decisions=[];let position=null,pending=null,cooldown=0;
 const close=(price,at,reason)=>{Object.assign(position,{status:'CLOSED',exit:price,exit_at:iso(at),exit_reason:reason,return_pct:position.side*(price-position.entry)/position.entry*100});if(position.return_pct<0)cooldown=at+1800000;position=null;};
 const barriers=(b,at,duration=180000)=>{if(!position)return;const s=position.side;if(s*(b.open-position.stop)<=0)close(b.open,at,'STOP HIT');else if(s*(b.open-position.target)>=0)close(b.open,at,'TARGET');else if(s*((s===1?b.low:b.high)-position.stop)<=0)close(position.stop,at+duration,'STOP HIT');else if(s*((s===1?b.high:b.low)-position.target)>=0)close(position.target,at+duration,'TARGET');};
 for(let i=0;i<rows.length;i++){
  const r=rows[i],open=stamp(r.bar_open),at=stamp(r.time);if(open>=now||open>=exitAt)break;
  if(pending){if(open===pending.at&&open<exitAt&&etParts(open).hm<'15:00'){
   position={id:[VERSION,r.symbol??'',iso(open),pending.side].join('|'),version:VERSION,shadow_only:true,eligible_for_execution:false,status:'OPEN',side:pending.side,decision_at:iso(pending.at),entry_at:iso(open),entry:r.open,stop:r.open-pending.side*.25*r.atr,target:r.open+pending.side*.5*r.atr,vix:pending.vix};trades.push(position);
  }pending=null;}
  if(at>now)break;
  if(position&&at<=exitAt)barriers(r,open);
  if(at>=exitAt)break;
  const v=vixAt(context.vix,at,session.date);let reason=!v?'DATA HOLD: VIX unavailable':'NO SETUP';
  const c=candidate(rows,i,context);
  if(c){reason=position?'POSITION OPEN':trades.length>=3?'DAILY CAP':at<cooldown?'LOSS COOLDOWN':'SHADOW ENTRY';if(reason==='SHADOW ENTRY')pending={...c,at};}
  decisions.push({time:r.time,shadow_only:true,eligible_for_execution:false,reason,side:c?.side??0,vix:v});
 }
 // A 3m candle straddling 15:55 is withheld; use exact contiguous 1m bars.
 if(position&&now>=exitAt){const start=stamp(session.open)+Math.floor((exitAt-stamp(session.open))/180000)*180000;let expected=start;
  for(const b of minutes.filter(b=>stamp(b.time)>=start&&stamp(b.time)+60000<=exitAt).sort((a,b)=>stamp(a.time)-stamp(b.time))){if(stamp(b.time)!==expected)break;barriers(b,expected,60000);expected+=60000;if(!position)break;if(expected===exitAt)close(b.close,exitAt,'TIME EXIT');}
  if(position)position.time_exit_pending=true;
 }
 return {version:VERSION,shadow_only:true,hidden_from_ui:true,eligible_for_execution:false,trades,decisions,position,pending,cooldown_until:cooldown?iso(cooldown):null,stats:retestStats(trades)};
}
