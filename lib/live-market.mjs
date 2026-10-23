// All four instruments share one replay implementation. The browser polls every
// 15s; TradingView history is fetched only when a new confirmed 3m bar is due.
import {readTradingView,TV_SYMBOLS} from './tradingview-feed.mjs';
import {buildLiveSnapshot,unavailableSnapshot,etParts} from './saty-live.mjs';
import {allocateEvidenceWeights} from '../site/weights.mjs';

export const MARKET_KEY = 'saty-plus/market-v2.json';
export function createMarketReader(evidence,calendar,{reader=readTradingView,clock=()=>Date.now(),build=buildLiveSnapshot}={}) {
  let cached=null,loaded=false,loading=null,inflight=null,checkedAt=0;
  const due = (snapshot,now) => {
    if(!snapshot||!['CURRENT','CLOSED','OPENING'].includes(snapshot.health?.state))return true;
    const local=etParts(now),s=calendar.sessions?.[local.day],last=Date.parse(snapshot.health.price_asof);
    if(s&&now>=Date.parse(s.open)&&now<Date.parse(s.close)){
      if(now<Date.parse(s.open)+185000)return false;
      return now>=last+185000;
    }
    const reference=Object.entries(calendar.sessions??{}).filter(([,v])=>Date.parse(v.close)<=now).at(-1)?.[1];
    return !reference||last<Date.parse(reference.close);
  };
  async function refresh(bucket,now) {
    const symbols={...(cached?.symbols??{})};
    await Promise.all(Object.keys(TV_SYMBOLS).map(async symbol=>{
      if(!due(symbols[symbol],now))return;
      try {const feed=await reader(symbol);symbols[symbol]=build(feed,evidence.by_symbol?.[symbol],calendar,clock());}
      catch(error){symbols[symbol]=unavailableSnapshot(symbol,error?.message??'TradingView feed failed',symbols[symbol],clock(),error?.attempts??[]);}
    }));
    cached={schema_version:2,generated_at:new Date(clock()).toISOString(),symbols,refresh_seconds:15,transport:'TradingView public chart WebSocket · no login'};
    checkedAt=clock();
    if(bucket)try{await bucket.put(MARKET_KEY,JSON.stringify(cached),{httpMetadata:{contentType:'application/json'}});}catch{cached.storage_note='Live bars available; durable market cache could not be saved';}
    return cached;
  }
  function present(value) {
    const now=clock(),local=etParts(now),row=calendar.sessions?.[local.day],inSession=!!row&&now>=Date.parse(row.open)&&now<Date.parse(row.close);
    const result={...value,symbols:{}};
    for(const [symbol,snapshot] of Object.entries(value.symbols)){
      const age=(now-Date.parse(snapshot.health?.price_asof))/1000,firstPending=inSession&&now<Date.parse(row.open)+185000;
      const failed=snapshot.health?.state==='UNAVAILABLE',fresh=!failed&&age>=0&&age<=225&&snapshot.session?.date===local.day;
      const state=failed?'UNAVAILABLE':!inSession?'CLOSED':firstPending&&!fresh?'OPENING':fresh?'CURRENT':'STALE';
      const weights=snapshot.evidence_weights??{};
      const reason=failed?snapshot.health.reason:state==='OPENING'?'Waiting for the first confirmed 09:30–09:33 bar':state==='CLOSED'?'Regular session closed; confirmed bars are reference data':state==='STALE'?'Expected confirmed bar missing; feed lag exceeds 225 seconds':'Fresh confirmed TradingView 3m bar';
      result.symbols[symbol]={...snapshot,session:{...snapshot.session,calendar_date:local.day,status:inSession?'OPEN':'CLOSED'},health:{...snapshot.health,state,reason,age_seconds:Number.isFinite(age)?Math.max(0,Math.round(age)):null},evidence_weights:{...weights,fresh,in_session:inSession,...allocateEvidenceWeights(weights.features,{fresh,inSession})}};
    }
    return result;
  }
  return async function getMarket(bucket) {
    if(inflight)return present(await inflight);
    const now=clock();
    if(!loaded){
      loading??=(async()=>{if(bucket)try{const value=await (await bucket.get(MARKET_KEY))?.json();cached=value?.schema_version===2&&value.symbols&&Object.keys(value.symbols).every(s=>TV_SYMBOLS[s])?value:null;}catch{cached=null;}loaded=true;})();
      await loading;
    }
    if(inflight)return present(await inflight);
    if(cached&&now-checkedAt<15000)return present(cached);
    if(cached&&Object.values(cached.symbols??{}).length===4&&!Object.values(cached.symbols).some(s=>due(s,now)))return present(cached);
    inflight=refresh(bucket,now);try{return present(await inflight);}finally{inflight=null;}
  };
}
