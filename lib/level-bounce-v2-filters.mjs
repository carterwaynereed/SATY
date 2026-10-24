// Shadow-only inputs. Confirmed native intervals; no synthetic 1H bars.
import {etParts} from './saty-live.mjs';
const T=Date.parse,finite=Number.isFinite,iso=t=>new Date(t).toISOString();
export function keyForDay(config,day){
 const override=config?.daily_keys?.[day];
 if(override&&!finite(T(override.recorded_at)))return null;
 const key=override?.key??config?.default_vix_key??16;
 return finite(key)&&key>0?{key,recorded_at:override?.recorded_at??null,origin:override?'DATED_OVERRIDE':'DEFAULT'}:null;
}
export function closedIntervals(bars,minutes,calendar,at){
 const seen=new Set();return (bars??[]).slice().sort((a,b)=>T(a.time)-T(b.time)).flatMap(b=>{
  const start=T(b.time),s=calendar.sessions?.[etParts(start).day],open=T(s?.open),end=Math.min(start+minutes*60000,T(s?.close));
  if(!s||start<open||start>=T(s.close)||(start-open)%(minutes*60000)!==0||end>at||seen.has(start)||![b.open,b.high,b.low,b.close].every(finite))return [];
  seen.add(start);return [{...b,known_at:iso(end)}];
 });
}
function expectedClose(minutes,calendar,at){let last=-Infinity;for(const s of Object.values(calendar.sessions??{})){const open=T(s.open),close=T(s.close);if(open>at)continue;for(let t=open;t<close;t+=minutes*60000){const end=Math.min(t+minutes*60000,close);if(end<=at)last=Math.max(last,end);}}return last;}
export function intervalIndicators(bars,minutes,calendar){
 const rows=closedIntervals(bars,minutes,calendar,Infinity);let ema=null,atr=null,pc=null,smooth=null;const out=[];
 for(const b of rows){ema=ema==null?b.close:ema+2/22*(b.close-ema);const tr=pc==null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc));pc=b.close;atr=atr==null?tr:atr+(tr-atr)/14;const raw=atr>0?(b.close-ema)/(3*atr)*100:0;smooth=smooth==null?raw:smooth+2/4*(raw-smooth);out.push({...b,ema21:ema,phase:smooth});}
 return out;
}
export function indicatorAt(rows,minutes,calendar,at){
 const known=(rows??[]).filter(b=>T(b.known_at)<=at);if(known.length<60)return null;
 const last=known.at(-1),expected=expectedClose(minutes,calendar,at);
 if(T(last.known_at)!==expected)return null;
 // Reject holes in the recent EMA warmup, including a missing completed hour.
 const start=T(known.at(-60).time),actual=new Set(known.slice(-60).map(b=>T(b.time)));
 for(const s of Object.values(calendar.sessions??{}))for(let t=Math.max(T(s.open),start);t<T(s.close)&&t<at;t+=minutes*60000)if(Math.min(t+minutes*60000,T(s.close))<=at&&!actual.has(t))return null;
 return last;
}
export function recentHigh(bars,index,atr,pdc){
 if(!(atr>0)||!finite(pdc))return null;
 let high=-Infinity,at=null;for(const b of bars.slice(0,index+1)){if(b.high>high){high=b.high;at=T(b.time)+180000;}}
 const r=bars[index],decision=T(r.time)+180000;
 return {blocked:r.close-pdc>.5*atr&&at!==null&&decision-at<=1800000,last_new_high_at:at===null?null:iso(at),change_atr:(r.close-pdc)/atr};
}
export function v2Gate(side,bars,index,{snapshot,calendar,v2},vix){
 const at=T(bars[index].time)+180000,day=snapshot.session.date,key=keyForDay(v2?.config,day);
 if(!key||key.recorded_at&&T(key.recorded_at)>T(snapshot.session.open))return {allowed:false,state:'DATA HOLD',reason:'VIX daily key missing, invalid or recorded after session open'};
 const five=indicatorAt(v2?.vix5,5,calendar,at);
 if(!five)return {allowed:false,state:'DATA HOLD',reason:'Confirmed VIX 5m EMA21 unavailable'};
 const risk=vix.close>key.key&&vix.close>=five.ema21;
 const evidence={key:key.key,key_origin:key.origin,key_recorded_at:key.recorded_at,vix:vix.close,vix5_ema21:five.ema21,vix5_at:five.known_at};
 if(side===1)return {allowed:!risk,state:'FILTER',reason:risk?'Long blocked by VIX key + 5m EMA':'Long passes VIX key gate',...evidence};
 if(!risk)return {allowed:false,state:'FILTER',reason:'Short requires VIX above key and at/above 5m EMA',...evidence};
 const hour=indicatorAt(v2?.hour,60,calendar,at);
 if(!hour)return {allowed:false,state:'DATA HOLD',reason:'Confirmed 1H close / EMA21 / Phase unavailable',...evidence};
 const high=recentHigh(bars,index,snapshot.market.atr14,snapshot.market.prev_close);
 if(!high)return {allowed:false,state:'DATA HOLD',reason:'PDC / day-high context unavailable',...evidence};
 const hourly=hour.close>hour.ema21&&hour.phase>20;
 return {allowed:!hourly&&!high.blocked,state:'FILTER',reason:hourly?'Short blocked: bullish 1H close + Phase >20':high.blocked?'Short blocked: up >0.5 ATR with recent new high':'Short passes v2 filters',...evidence,hour_at:hour.known_at,hour_close:hour.close,hour_ema21:hour.ema21,hour_phase:hour.phase,...high};
}
