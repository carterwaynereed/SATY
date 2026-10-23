import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketReader,MARKET_KEY} from '../lib/live-market.mjs';
import {createWorker} from '../hosting/worker.mjs';

const SYMBOLS=['SPY','SPX','AAPL','GOOGL'];
const t=s=>Date.parse(s);
const session=day=>({open:day+'T13:30:00.000Z',close:day+'T20:00:00.000Z'});
const calendar={sessions:Object.fromEntries(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26'].map(day=>[day,session(day)]))};
const evidence={by_symbol:Object.fromEntries(SYMBOLS.map(symbol=>[symbol,{stats_id:'test-'+symbol,built:'2026-10-23T12:00:00Z',training_to:'2026-10-22',source:{fingerprint:'sha256:cache-test-'+symbol},cells:[]}]))};
const bar=(time,index,volume=100)=>({time:new Date(time).toISOString(),open:100+index/100,high:100.2+index/100,low:99.9+index/100,close:100.1+index/100,volume});
// Synthetic values exist only in this test fixture. Four genuine-length RTH
// warmup sessions exercise the actual engine, rather than a mirror of the cache.
function feed(symbol,now) {
  const day=new Date(now).toISOString().slice(0,10),days=['2026-10-19','2026-10-20','2026-10-21','2026-10-22'];
  if(day>'2026-10-23')days.push('2026-10-23');
  days.push(day);
  const bars=[];
  for(const d of days)for(let start=t(d+'T13:30:00Z');start<t(d+'T20:00:00Z')&&start+180000<=now;start+=180000)bars.push(bar(start,bars.length,symbol==='SPX'?null:100));
  const daily=[];
  for(let date=t('2026-03-02T13:30:00Z');date<t(day+'T13:30:00Z');date+=86400000)if(![0,6].includes(new Date(date).getUTCDay()))daily.push({time:new Date(date).toISOString(),open:100,high:101,low:99,close:100,volume:1000});
  const trend=[];
  for(const d of days)for(let start=t(d+'T13:30:00Z');start<t(d+'T20:00:00Z')&&start+600000<=now;start+=600000)trend.push(bar(start,trend.length));
  return {symbol,source:{provider:'TradingView',symbol: symbol==='SPX'?'TVC:SPX':symbol==='SPY'?'AMEX:SPY':'NASDAQ:'+symbol,source_id:symbol==='SPX'?'TVC':'BATS',feed_fingerprint:'sha256:cache-test-'+symbol},bars,trend_bars:trend,daily,attempts:[{symbol,status:'OK'}]};
}
class Bucket {
  data=new Map();reads=[];writes=[];
  async get(key){this.reads.push(key);const value=this.data.get(key);return value?{json:async()=>JSON.parse(value)}:null;}
  async put(key,value){this.writes.push(key);this.data.set(key,value);return {};}
}
function setup(start='2026-10-23T14:00:05Z',options={}) {
  let now=t(start);const calls=[];
  const reader=async symbol=>{calls.push({symbol,at:now});return options.reader?options.reader(symbol,now):feed(symbol,now);};
  const get=createMarketReader(evidence,calendar,{reader,clock:()=>now}),bucket=new Bucket();
  return {get,bucket,calls,set:time=>{now=typeof time==='number'?time:t(time);},now:()=>now};
}

test('market request fans out to four independent tickers and shares concurrent refresh work',async()=>{
  const x=setup();const [a,b]=await Promise.all([x.get(x.bucket),x.get(x.bucket)]);
  assert.deepEqual(Object.keys(a.symbols).sort(),[...SYMBOLS].sort());assert.equal(x.calls.length,4);assert.deepEqual(a,b);
  for(const symbol of SYMBOLS){const s=a.symbols[symbol];assert.equal(s.market.symbol,symbol);assert.equal(s.health.source.baseline_compatible,true);assert.equal(s.health.state,'CURRENT');assert.equal(s.evidence_weights.in_session,true);assert.equal(s.evidence_weights.call+s.evidence_weights.put+s.evidence_weights.wait,100);assert.ok(s.evidence_weights.call>0||s.evidence_weights.put>0);}
  assert.deepEqual(x.bucket.writes,[MARKET_KEY]);assert.equal(MARKET_KEY,'saty-plus/market-v2.json');
});

test('fresh bar cache survives polling and refreshes at the next close plus five seconds',async()=>{
  const x=setup();await x.get(x.bucket);assert.equal(x.calls.length,4);
  x.set('2026-10-23T14:00:20Z');const cached=await x.get(x.bucket);assert.equal(x.calls.length,4);assert.equal(cached.symbols.SPY.health.age_seconds,20);
  x.set('2026-10-23T14:03:04Z');await x.get(x.bucket);assert.equal(x.calls.length,4);
  x.set('2026-10-23T14:03:05Z');const fresh=await x.get(x.bucket);assert.equal(x.calls.length,8);assert.equal(fresh.symbols.SPY.health.price_asof,'2026-10-23T14:03:00.000Z');
});

test('failed symbol is held independently and retries after 15 seconds without refetching good tickers',async()=>{
  let failed=true;const x=setup('2026-10-23T14:00:05Z',{reader:(symbol,now)=>{if(symbol==='SPX'&&failed)throw Object.assign(new Error('Both requested index symbols unavailable'),{attempts:[{symbol:'TVC:SPX',status:'ERROR'},{symbol:'SP:SPX',status:'ERROR'}]});return feed(symbol,now);}});
  const first=await x.get(x.bucket);assert.equal(first.symbols.SPX.health.state,'UNAVAILABLE');assert.equal(first.symbols.SPX.plan.state,'DATA_HOLD');assert.equal(first.symbols.SPX.evidence_weights.wait,100);assert.deepEqual(first.symbols.SPX.health.attempts.map(a=>a.symbol),['TVC:SPX','SP:SPX']);
  for(const symbol of ['SPY','AAPL','GOOGL'])assert.equal(first.symbols[symbol].health.state,'CURRENT');
  x.set('2026-10-23T14:00:19Z');await x.get(x.bucket);assert.equal(x.calls.length,4);
  failed=false;x.set('2026-10-23T14:00:20Z');const retry=await x.get(x.bucket);assert.equal(x.calls.length,5);assert.equal(x.calls.at(-1).symbol,'SPX');assert.equal(retry.symbols.SPX.health.state,'CURRENT');
});

test('durable market cache reload keeps public market state isolated from the paper journal',async()=>{
  const x=setup();await x.get(x.bucket);
  x.bucket.data.set('saty-plus/desk-v1.json',JSON.stringify({journal:[{private:'DO_NOT_READ'}],notes:['DO_NOT_READ']}));
  let calls=0;const get=createMarketReader(evidence,calendar,{reader:async()=>{calls++;throw new Error('No refresh due');},clock:()=>t('2026-10-23T14:01:00Z')});
  const cached=await get(x.bucket);assert.equal(calls,0);assert.equal(cached.symbols.SPY.health.age_seconds,60);assert.doesNotMatch(JSON.stringify(cached),/DO_NOT_READ|journal|private/);
  assert.ok(x.bucket.reads.every(key=>key===MARKET_KEY));
});

test('closing cache disables intraday weights, then next session waits for the first confirmed bar',async()=>{
  const x=setup('2026-10-23T19:57:05Z');await x.get(x.bucket);
  x.set('2026-10-23T20:00:05Z');const closed=await x.get(x.bucket);assert.equal(closed.symbols.SPY.health.state,'CLOSED');assert.equal(closed.symbols.SPY.evidence_weights.in_session,false);assert.equal(closed.symbols.SPY.evidence_weights.wait,100);
  const count=x.calls.length;x.set('2026-10-24T15:00:00Z');const weekend=await x.get(x.bucket);assert.equal(x.calls.length,count);assert.equal(weekend.symbols.SPY.health.state,'CLOSED');assert.equal(weekend.symbols.SPY.evidence_weights.wait,100);
  x.set('2026-10-26T13:31:00Z');const opening=await x.get(x.bucket);assert.equal(x.calls.length,count);assert.equal(opening.symbols.SPY.health.state,'OPENING');assert.equal(opening.symbols.SPY.evidence_weights.wait,100);assert.equal(opening.symbols.SPY.evidence_weights.fresh,false);assert.equal(opening.symbols.SPY.session.calendar_date,'2026-10-26');assert.equal(opening.symbols.SPY.session.status,'OPEN');assert.match(opening.symbols.SPY.health.reason,/first|09:30/i);
  x.set('2026-10-26T13:33:05Z');const current=await x.get(x.bucket);assert.equal(x.calls.length,count+4);assert.equal(current.symbols.SPY.health.state,'CURRENT');assert.equal(current.symbols.SPY.session.date,'2026-10-26');
});

test('failed refresh retains prior prices as references and never keeps fresh allocation',async()=>{
  let failed=false;const x=setup('2026-10-23T14:00:05Z',{reader:(symbol,now)=>{if(failed)throw new Error('Public feed failed');return feed(symbol,now);}});
  const prior=await x.get(x.bucket);failed=true;x.set('2026-10-23T14:03:05Z');const held=await x.get(x.bucket);
  for(const symbol of SYMBOLS){assert.equal(held.symbols[symbol].market.last,prior.symbols[symbol].market.last);assert.equal(held.symbols[symbol].health.state,'UNAVAILABLE');assert.equal(held.symbols[symbol].evidence_weights.fresh,false);assert.equal(held.symbols[symbol].evidence_weights.wait,100);}
});

test('public market API shares exact data with Pages, supports conditional reads, and never reads the private journal',async()=>{
  const x=setup();let privateReads=0,privateWrites=0;
  const worker=createWorker({},async()=>{privateReads++;return {journal:['PRIVATE']};},async()=>{privateWrites++;},x.get);
  const response=await worker.fetch(new Request('https://desk.example/api/market'),{BUCKET:x.bucket});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  const home=await response.text();assert.doesNotMatch(home,/PRIVATE|journal/);assert.equal(privateReads,0);assert.equal(privateWrites,0);
  const origin='https://carterwaynereed.github.io';
  const mirrored=await worker.fetch(new Request('https://desk.example/api/market',{headers:{Origin:origin}}),{BUCKET:x.bucket});
  assert.equal(mirrored.status,200);assert.equal(await mirrored.text(),home);
  assert.equal(mirrored.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(mirrored.headers.get('Access-Control-Allow-Credentials'),null);
  const etag=mirrored.headers.get('ETag');assert.ok(etag);assert.equal(etag,response.headers.get('ETag'));
  const cached=await worker.fetch(new Request('https://desk.example/api/market',{headers:{Origin:origin,'If-None-Match':etag}}),{BUCKET:x.bucket});
  assert.equal(cached.status,304);assert.equal(await cached.text(),'');assert.equal(cached.headers.get('Access-Control-Allow-Origin'),origin);
  x.set('2026-10-23T14:03:05Z');
  const newer=await worker.fetch(new Request('https://desk.example/api/market',{headers:{Origin:origin,'If-None-Match':etag}}),{BUCKET:x.bucket});
  assert.equal(newer.status,200);assert.notEqual(newer.headers.get('ETag'),etag);
  assert.equal((await newer.json()).symbols.SPY.health.price_asof,'2026-10-23T14:03:00.000Z');
  assert.equal(privateReads,0);assert.equal(privateWrites,0);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await worker.fetch(new Request('https://desk.example/api/market',{method}),{BUCKET:x.bucket})).status,404);
});
