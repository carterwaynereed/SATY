import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketReader,snapshotHealth} from '../site/assets/app.js';
const snapshot={market:{last:760},health:{state:'CURRENT',price_asof:'2026-10-23T15:00:00Z',ttl_seconds:225},session:{date:'2026-10-23',status:'OPEN',open:'2026-10-23T13:30:00Z',close:'2026-10-23T20:00:00Z',refresh_seconds:15}};
const bundle={schema_version:2,symbols:{SPY:snapshot}};
test('a conditional 304 retains the valid bundle while browser freshness keeps aging',async()=>{
  const requests=[],responses=[new Response(JSON.stringify(bundle),{headers:{ETag:'"bar-1500"'}}),new Response(null,{status:304})];
  const read=createMarketReader(async(url,options)=>{requests.push({url,options});return responses.shift();});
  const first=await read('/api/market',{sameOrigin:true}),second=await read('/api/market',{sameOrigin:true});
  assert.equal(second,first);assert.equal(requests[1].options.headers['If-None-Match'],'"bar-1500"');
  assert.equal(snapshotHealth(second.symbols.SPY,Date.parse('2026-10-23T15:02:00Z')).state,'CURRENT BAR');
  assert.equal(snapshotHealth(second.symbols.SPY,Date.parse('2026-10-23T15:04:00Z')).state,'STALE SNAPSHOT');
});
test('public mirror never receives a private ETag or same-origin credentials',async()=>{
  const requests=[];const read=createMarketReader(async(url,options)=>{requests.push(options);return new Response(JSON.stringify(bundle),{headers:{ETag:'"private-tag"'}});});
  await read('/api/market',{sameOrigin:true});await read('https://raw.githubusercontent.com/example/market.json');
  assert.deepEqual(requests[1].headers,{});assert.equal(requests[1].credentials,'omit');
});
test('an orphan 304 and actual failed request are errors, not fresh successes',async()=>{
  await assert.rejects(createMarketReader(async()=>new Response(null,{status:304}))('/api/market',{sameOrigin:true}),/without a prior/);
  await assert.rejects(createMarketReader(async()=>new Response('unavailable',{status:503}))('/api/market',{sameOrigin:true}),/HTTP 503/);
});
