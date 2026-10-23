import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFeed} from '../lib/feed-ingest.mjs';
import {analyze} from '../site/engine.mjs';
import {validateSnapshot,writeHosted,readHosted} from '../lib/hosted-snapshot.mjs';
const now=Date.parse('2026-10-23T19:30:20Z');
const bar=(minute,extra={})=>({ticker:'SPY',start:`2026-10-23T19:${minute}:00Z`,end:`2026-10-23T19:${Number(minute)+1}:00Z`,o:100,h:101,l:99,c:100,vol:100,market:'r',...extra});
const daily=[{date:'2026-10-22',open:100,high:101,low:99,close:100}];
test('ingest permanently excludes candles unfinished at provider retrieval time',()=>{
 const feed=prepareFeed({daily},{symbol:'SPY',retrievedAt:new Date(now).toISOString(),bars:[bar(29),bar(30)]},now);
 assert.equal(feed.bars.length,1);assert.equal(feed.quality.partialExcluded,1);
 const later=analyze({...feed,symbol:'SPY'},now+60000,{activeSymbols:['SPY']});
 assert(later.gates.some(g=>g.includes('No completed'))); // incomplete 3m bucket
 assert.equal(feed.bars[0].end,'2026-10-23T19:30:00Z');
});
test('observed cutoff also protects legacy stored partial bars from later use',()=>{
 const result=analyze({symbol:'SPY',profile:{entry:1,trend:3},bars:[bar(29),bar(30)],fetchedAt:new Date(now).toISOString()},now+120000);
 assert.equal(result.asOf,'2026-10-23T19:30:00Z');assert.equal(result.decision,'WAIT');
});
test('failed refresh retains prior evidence without pretending it is fresh',()=>{
 const old={bars:[bar(29)],daily,fetchedAt:'2026-10-23T19:30:00Z'};
 const next=prepareFeed(old,{retrievedAt:new Date(now).toISOString(),error:'Provider unavailable'},now);
 assert.equal(next.fetchedAt,old.fetchedAt);assert.equal(next.bars,old.bars);assert.equal(next.error,'Provider unavailable');
 assert.throws(()=>prepareFeed(old,{symbol:'SPY',retrievedAt:new Date(now).toISOString(),bars:[]},now),/Empty candles/);
 assert.throws(()=>prepareFeed(old,{symbol:'SPY',retrievedAt:'2026-10-23T19:29:00Z',bars:[bar(29)]},now),/Out-of-order/);
});
test('provider delay and malformed rows are preserved, not silently repaired',()=>{
 const feed=prepareFeed({daily},{symbol:'SPY',retrievedAt:new Date(now).toISOString(),bars:[bar(29),bar(28,{h:0})],delayed:true,notices:['Free plan']},now);
 assert.equal(feed.delayed,true);assert.equal(feed.bars.length,2);assert.equal(feed.quality.rejected,1);
});
test('incremental refresh preserves warm-up history and gaps, replaces provider revisions',()=>{
 const old={bars:[bar(27),bar(29),bar(30)],daily,fetchedAt:new Date(now).toISOString()};
 const next=prepareFeed(old,{symbol:'SPY',incremental:true,retrievedAt:'2026-10-23T19:32:20Z',bars:[bar(29,{c:100.5}),bar(31)]},now+120000);
 assert.equal(next.bars.length,3);assert(next.bars.some(b=>b.start.includes('19:27')));
 assert.equal(next.bars.find(b=>b.start.includes('19:29')).c,100.5);
 assert(!next.bars.some(b=>b.start.includes('19:28')));assert(!next.bars.some(b=>b.start.includes('19:30')));
 assert.equal(next.daily,old.daily);
});
test('SPY-only focus and EOD calendar coverage are enforced',()=>{
 const context={activeSymbols:['SPY'],eventsReviewedAt:'2026-10-23T18:00:00Z',eventSource:'https://www.federalreserve.gov/newsevents/2026-october.htm',eventsValidUntil:'2026-10-23T19:00:00Z'};
 const spy=analyze({symbol:'SPY',profile:{entry:1,trend:3},bars:[bar(29)]},now,context);
 assert(spy.gates.includes('Outside verified economic-calendar coverage'));
 const other=analyze({symbol:'AAPL'},now,context);assert(other.gates.includes('Paused: SPY-only focus'));
 const cutoff=analyze({symbol:'SPY',profile:{entry:1,trend:3},bars:[bar(49)]},Date.parse('2026-10-23T19:50:00Z'),context);
 assert(cutoff.gates.some(g=>g.includes('Final ten minutes')));
});
const snapshot=()=>({generatedAt:new Date(now).toISOString(),feeds:{symbols:{SPY:{bars:[bar(29)],daily,fetchedAt:new Date(now).toISOString()}}},context:{activeSymbols:['SPY']},journal:[]});
class Bucket{value=null;etag='0';conflict=false;async get(){return this.value?{etag:this.etag,json:async()=>JSON.parse(this.value)}:null;}async put(k,v,opts){if(this.conflict)return null;if(opts.onlyIf.etagMatches&&opts.onlyIf.etagMatches!==this.etag)return null;this.value=v;this.etag=String(Number(this.etag)+1);return {etag:this.etag};}}
test('hosted storage survives reads, rejects rollback and replays idempotently',async()=>{
 const bucket=new Bucket();assert.equal(await readHosted(bucket,now),null);
 assert.equal((await writeHosted(bucket,snapshot(),now)).saved,true);
 assert.equal((await writeHosted(bucket,snapshot(),now)).saved,false);
 const old=snapshot();old.generatedAt='2026-10-23T19:00:00Z';assert.equal((await writeHosted(bucket,old,now)).saved,false);
 const result=await readHosted(bucket,now+120000);assert.equal(result.mode,'hosted');assert.equal(result.paperEntryMode,'scheduled');assert.equal(result.analyses[0].decision,'WAIT');
 assert.equal(result.generatedAt,new Date(now).toISOString());
});
test('hosted payloads require a dated SPY feed and refuse concurrent overwrites',async()=>{
 const invalid=snapshot();invalid.feeds.symbols.SPY.fetchedAt=null;assert.throws(()=>validateSnapshot(invalid,now),/retrieval time/);
 const future=snapshot();future.generatedAt=new Date(now+60000).toISOString();assert.throws(()=>validateSnapshot(future,now),/snapshot time/);
 const bucket=new Bucket();bucket.conflict=true;await assert.rejects(()=>writeHosted(bucket,snapshot(),now),/Concurrent/);
});
