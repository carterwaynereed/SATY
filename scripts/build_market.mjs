import {attachApproved} from '../lib/approved-policy.mjs';
// Convert the same verified TradingView feed contract into the public mirror.
// The hosted Site obtains bars itself; this file is only the scheduled reference.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildLiveSnapshot,unavailableSnapshot} from '../lib/saty-live.mjs';
import {recordResearch} from './record_research.mjs';
import {canonicalFeed} from '../lib/canonical-feed.mjs';
import {aggregateTenMinutes} from '../lib/tradingview-feed.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const input=option('--input');if(!input)throw new Error('--input JSON is required');
const captured=JSON.parse(await readFile(input,'utf8')),feeds=captured.feeds??captured;
const evidence=JSON.parse(await readFile(resolve(root,'site/data/tv-evidence.json'),'utf8'));
const calendar=JSON.parse(await readFile(resolve(root,'hosting/session-calendar.json'),'utf8'));
const now=option('--now')?Date.parse(option('--now')):Date.now(),symbols={};
for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
  try{let feed=feeds[symbol];if(!feed||feed.error)throw new Error(feed?.error??'No captured TradingView feed');feed=feeds[symbol]=canonicalFeed(feed);if(!feed.trend_bars)feed.trend_bars=aggregateTenMinutes(feed.one_bars??[],now);symbols[symbol]=attachApproved(feed,buildLiveSnapshot(feed,evidence.by_symbol[symbol],calendar,now),now);}
  catch(error){symbols[symbol]=unavailableSnapshot(symbol,error.message,null,now,feeds[symbol]?.attempts??[]);}
}
if(option('--state-dir')){const summary=await recordResearch(feeds,symbols,resolve(option('--state-dir')),now);await writeFile(resolve(root,'site/data/decision-summary.json'),JSON.stringify(summary)+'\n');}
const result={schema_version:2,generated_at:new Date(now).toISOString(),symbols,transport:'TradingView public feed; scheduled reference on the static mirror',refresh_seconds:15};
await writeFile(resolve(option('--output',resolve(root,'site/data/market.json'))),JSON.stringify(result,(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(symbols).map(([s,v])=>[s,{price:v.market.last,asof:v.health.price_asof,state:v.health.state,weights:[v.evidence_weights.call,v.evidence_weights.put,v.evidence_weights.wait],source_matches:v.health.source?.baseline_compatible,one_minute_n:v.one_minute_bars?.length??0,one_minute_state:v.one_minute_health?.state}]))));

const held=Object.entries(symbols).filter(([,s])=>s.health?.state==='UNAVAILABLE');
if(held.length){console.error('Snapshot build failed: '+held.map(([s,v])=>s+': '+v.health.reason).join('; '));process.exitCode=1;}
