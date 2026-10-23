import {analyze,journalStats} from '../site/engine.mjs';
export const SNAPSHOT_KEY='saty-plus/desk-v1.json';
export function validateSnapshot(value,now=Date.now()){
 if(!value||!value.feeds?.symbols?.SPY||!Array.isArray(value.journal)||value.journal.length>10000)throw new Error('Invalid desk snapshot');
 const at=Date.parse(value.generatedAt);if(!Number.isFinite(at)||at>now+5000)throw new Error('Invalid snapshot time');
 if(JSON.stringify(value.context?.activeSymbols)!=='["SPY"]')throw new Error('SPY-only focus is required');
 for(const [symbol,feed] of Object.entries(value.feeds.symbols)){
  if(!['SPY','SPX','AAPL','GOOGL'].includes(symbol)||!Array.isArray(feed.bars)||feed.bars.length>10000||!Array.isArray(feed.daily??[])||(feed.daily??[]).length>500)throw new Error('Invalid feed shape');
  if(feed.bars.length&&!Number.isFinite(Date.parse(feed.fetchedAt)))throw new Error('Feed retrieval time required');
 }
 return value;
}
export function presentSnapshot(value,now=Date.now()){
 const context={...value.context,activeSymbols:['SPY']};
 const analyses=['SPY','SPX','AAPL','GOOGL'].map(symbol=>analyze({...value.feeds.symbols[symbol],symbol},now,context));
 return {...value,mode:'hosted',paperEntryMode:'scheduled',servedAt:new Date(now).toISOString(),context,analyses,stats:journalStats(value.journal)};
}
export async function readHosted(bucket,now=Date.now()){
 const object=await bucket.get(SNAPSHOT_KEY);if(!object)return null;
 return presentSnapshot(await object.json(),now);
}
export async function writeHosted(bucket,value,now=Date.now()){
 validateSnapshot(value,now);
 const prior=await bucket.get(SNAPSHOT_KEY);const old=prior?await prior.json():null;
 if(old&&Date.parse(old.generatedAt)>=Date.parse(value.generatedAt))return {saved:false,reason:'Already have this or a newer scan',generatedAt:old.generatedAt};
 const options={httpMetadata:{contentType:'application/json'},onlyIf:prior?{etagMatches:prior.etag}:{etagDoesNotMatch:'*'}};
 const saved=await bucket.put(SNAPSHOT_KEY,JSON.stringify(value),options);
 if(!saved)throw new Error('Concurrent update; read the saved scan before retrying');
 return {saved:true,generatedAt:value.generatedAt,asOf:value.feeds.symbols.SPY.quality?.latestCompletedEnd??null};
}
