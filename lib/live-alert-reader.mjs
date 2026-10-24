import {readAlertInterval,TV_SYMBOLS} from './tradingview-feed.mjs';
import {intervalRows,intervalAt,replayAlertDesk} from './live-alerts.mjs';
import {etParts} from './saty-live.mjs';
export function createAlertReader(calendar,events,{reader=readAlertInterval,clock=()=>Date.now()}={}){
 let aux={hours:{}},checked=0,inflight=null,loaded=false;
 return async function attachAlerts(bundle,bucket,context){
  if(!loaded){try{if(bucket){const saved=await(await bucket.get('saty-plus/live-alert-native-v1.json'))?.json();if(saved?.hours)aux=saved;}}catch{}loaded=true;}
  const now=clock(),day=Object.values(bundle.symbols??{}).map(s=>s.session?.date).filter(Boolean).sort().at(-1);
  if(!day)return bundle;
  const active=etParts(now).day===day&&now>=Date.parse(calendar.sessions[day]?.open)&&now<Date.parse(calendar.sessions[day]?.close)+60000;
  if(!checked||active&&now-checked>=60000){inflight??=(async()=>{checked=now;let changed=false;
   await Promise.all([ (async()=>{if(intervalAt(intervalRows(aux.vix15,15,calendar),15,calendar,now))return;try{aux.vix15=await reader('CBOE:VIX',15);changed=true;}catch{}})(),...Object.entries(bundle.symbols??{}).map(async([s,v])=>{if(intervalAt(intervalRows(aux.hours[s],60,calendar),60,calendar,now))return;try{const source=v.health?.source?.symbol??TV_SYMBOLS[s]?.[0];if(source)aux.hours[s]=await reader(source,60);changed=true;}catch{}})]);if(changed&&bucket)try{await bucket.put('saty-plus/live-alert-native-v1.json',JSON.stringify(aux),{httpMetadata:{contentType:'application/json'}});}catch{}
  })();try{await inflight;}finally{inflight=null;}}else if(inflight)await inflight;
  const key='saty-plus/live-alerts-v1/'+day+'.json';let result;
  for(let attempt=0;attempt<3;attempt++){
   let prior=null,etag=null;try{if(bucket){const object=await bucket.get(key);etag=object?.etag;prior=await object?.json();}}catch{}
   result=replayAlertDesk(bundle,context,aux,calendar,events,now,prior?.accepted??[]);
   if(!active)break;
   try{const saved=await bucket.put(key,JSON.stringify({schema_version:1,day,observed_at:new Date(now).toISOString(),accepted:result._reservations}),{httpMetadata:{contentType:'application/json'},onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});if(saved!==null)break;if(attempt<2)continue;}catch{}
   // A failed budget write cannot authorize additional alerts.
   result=replayAlertDesk(bundle,context,aux,calendar,events,now,prior?.accepted??[]);const allowed=new Set((prior?.accepted??[]).map(t=>t.id));
   for(const s of Object.values(result.symbols)){for(const field of ['approved_rules','level_bounce'])if(s[field]){s[field].trades=s[field].trades.filter(t=>allowed.has(t.id));s[field].position=s[field].trades.find(t=>t.status==='TRACKING')??null;s[field].pending=null;s[field].state='DATA HOLD';s[field].last_event=null;}
    s.live_alerts.trades=s.live_alerts.trades.filter(t=>allowed.has(t.id));s.live_alerts.stats={n:null,target_hit_rate:null,closed_green_rate:null,profit_factor:null};s.live_alerts.holds.push('DATA HOLD: daily alert budget could not be persisted');}
   result.alert_budget.state='DATA HOLD';result.alert_budget.total=allowed.size;for(const [symbol,s] of Object.entries(result.symbols)){s.live_alerts.global_total=allowed.size;s.live_alerts.ticker_total=(prior?.accepted??[]).filter(t=>t.symbol===symbol).length;for(const field of ['approved_rules','level_bounce'])if(s[field])s[field].entries_today=s[field].trades.length;}break;
  }
  const {_reservations,...publicResult}=result;return publicResult;
 };
}
