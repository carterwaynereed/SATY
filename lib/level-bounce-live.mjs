import {readVixTradingView,readExtendedTradingView} from './tradingview-feed.mjs';
import {replayBounce,overnightReference} from './level-bounce.mjs';
import {etParts} from './saty-live.mjs';
export const BOUNCE_CONTEXT_KEY='saty-plus/level-bounce-context-v1.json';
export function createBounceReader(calendar,events,{vixReader=readVixTradingView,overnightReader=readExtendedTradingView,clock=()=>Date.now()}={}){
 let context=null,loaded=false,inflight=null,loggedAt=0;
 return async function attachBounce(bundle,bucket){
  const now=clock(),day=etParts(now).day,session=calendar.sessions?.[day],active=session&&now>=Date.parse(session.open)&&now<Date.parse(session.close)+60000;
  if(!loaded){if(bucket)try{context=await(await bucket.get(BOUNCE_CONTEXT_KEY))?.json();}catch{}loaded=true;}
  context??={};if(context.day!==day)context={day,overnight:{},vix:null,checked_at:0,overnight_attempts:{}};
  if(session&&(active||!context.checked_at)&&now-(context.checked_at??0)>=180000){
   inflight??=(async()=>{
    context.checked_at=now;
    await Promise.all([(async()=>{try{context.vix=await vixReader();context.vix_error=null;}catch(e){context.vix_error=e.message;}})(),...['SPY','AAPL','GOOGL'].map(async symbol=>{if(context.overnight[symbol]||now-(context.overnight_attempts?.[symbol]??0)<600000)return;context.overnight_attempts??={};context.overnight_attempts[symbol]=now;try{const feed=await overnightReader(symbol);const ref=overnightReference(feed,{date:day},calendar);if(ref)context.overnight[symbol]=ref;}catch{}})]);
    if(bucket)try{await bucket.put(BOUNCE_CONTEXT_KEY,JSON.stringify(context),{httpMetadata:{contentType:'application/json'}});}catch{}
   })();try{await inflight;}finally{inflight=null;}
  }else if(inflight)await inflight;
  const symbols={},ledger={schema_version:1,day,observed_at:new Date(now).toISOString(),signal_only:true,symbols:{}};for(const [symbol,s] of Object.entries(bundle.symbols??{})){
   try{const result=replayBounce(s,{reference:s.bounce_reference,overnight:context.day===s.session.date?context.overnight[symbol]:null,vix:context.day===s.session.date?context.vix:null,events,calendar},{now});ledger.symbols[symbol]=result;const {decisions,...publicResult}=result;symbols[symbol]={...s,level_bounce:publicResult};}
   catch(e){symbols[symbol]={...s,level_bounce:{label:'Level Bounce',state:'DATA HOLD',reason:e.message,trades:[],entries_today:0,signal_only:true}};}
  }
  if(bucket&&active&&now-loggedAt>=60000){try{await bucket.put('saty-plus/level-bounce/'+day+'.json',JSON.stringify(ledger),{httpMetadata:{contentType:'application/json'}});loggedAt=now;}catch{}}
  return {...bundle,symbols};
 };
}
