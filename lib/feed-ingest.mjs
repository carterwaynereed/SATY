import {eastern,normalizeBars} from '../site/engine.mjs';

// This accepts results already obtained through the authorized UW tool. It never
// fetches a replacement market feed or changes provider candle timestamps.
export function prepareFeed(previous={},update={},receivedAt=Date.now()) {
 const at=Date.parse(update.retrievedAt);
 if(!Number.isFinite(at)||at>receivedAt+5000)throw new Error('Invalid provider retrieval time');
 if(previous.fetchedAt&&at<Date.parse(previous.fetchedAt))throw new Error('Out-of-order feed update');
 if(update.error)return {...previous,error:String(update.error),lastAttemptAt:update.retrievedAt};
 if(!Array.isArray(update.bars)||!update.bars.length)throw new Error('Empty candles are a failed refresh, not a valid feed');
 const symbol=update.symbol;
 if(symbol!=='SPY')throw new Error('Only SPY refreshes are enabled');
 const completed=update.bars.filter(b=>!Number.isFinite(Date.parse(b.end))||Date.parse(b.end)<=at);
 let stored=completed;
 if(update.incremental===true){
  if(!previous.bars?.length||!previous.fetchedAt)throw new Error('Incremental refresh requires an initialized history');
  const starts=new Set(completed.map(b=>b.start));
  const prior=previous.bars.filter(b=>!starts.has(b.start)&&(!Number.isFinite(Date.parse(b.end))||Date.parse(b.end)<=Date.parse(previous.fetchedAt)));
  stored=[...completed,...prior].sort((a,b)=>(Date.parse(b.start)||Infinity)-(Date.parse(a.start)||Infinity)).slice(0,5000);
 }
 const n=normalizeBars(stored,symbol,at);
 if(!n.bars.length)throw new Error('No valid completed candles');
 const fresh={...previous,bars:stored,fetchedAt:update.retrievedAt,lastAttemptAt:update.retrievedAt,
  delayed:update.delayed===true,providerNotices:update.notices??[],error:null,
  quality:{received:update.bars.length,partialExcluded:update.bars.length-completed.length,rejected:n.rejected,latestCompletedEnd:n.bars.at(-1).end}};
 if(update.daily!==undefined){if(!Array.isArray(update.daily))throw new Error('Invalid daily history');fresh.daily=update.daily;fresh.dailyFetchedAt=update.retrievedAt;}
 if(!(fresh.daily??[]).some(b=>b.date<eastern(at).date))fresh.error='Previous completed daily history unavailable';
 return fresh;
}
