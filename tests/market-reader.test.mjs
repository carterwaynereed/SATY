import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketReader,createEvidenceReader,snapshotHealth,marketEndpoints,PUBLIC_DESK_ORIGIN} from '../site/assets/app.js';
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
test('changing URL never sends the old endpoint ETag or same-origin credentials',async()=>{
  const requests=[];const read=createMarketReader(async(url,options)=>{requests.push(options);return new Response(JSON.stringify(bundle),{headers:{ETag:'"private-tag"'}});});
  await read('/api/market',{sameOrigin:true});await read('https://raw.githubusercontent.com/example/market.json');
  assert.deepEqual(requests[1].headers,{});assert.equal(requests[1].credentials,'omit');
});
test('Pages uses the same public market and evidence endpoints as the home',()=>{
  const home=marketEndpoints(new URL(PUBLIC_DESK_ORIGIN).hostname),pages=marketEndpoints('carterwaynereed.github.io');
  assert.equal(new URL(home.market,PUBLIC_DESK_ORIGIN).href,pages.market);
  assert.equal(new URL(home.evidence,PUBLIC_DESK_ORIGIN).href,pages.evidence);
  assert.equal(home.sameOrigin,true);assert.equal(pages.sameOrigin,false);
  assert.equal(marketEndpoints('terminal.local').market,'/api/market');
});
test('public cross-origin ETags reuse the same bundle with credentials omitted',async()=>{
  const requests=[],responses=[new Response(JSON.stringify(bundle),{headers:{ETag:'W/"public-bar"'}}),new Response(null,{status:304})];
  const read=createMarketReader(async(url,options)=>{requests.push(options);return responses.shift();});
  const url=marketEndpoints('carterwaynereed.github.io').market;
  const first=await read(url),second=await read(url);
  assert.equal(second,first);assert.equal(requests[1].headers['If-None-Match'],'W/"public-bar"');
  assert.ok(requests.every(r=>r.credentials==='omit'));
  assert.equal(snapshotHealth(second.symbols.SPY,Date.parse('2026-10-23T15:04:00Z')).state,'STALE SNAPSHOT');
});
test('an in-flight response from another URL cannot overwrite the active URL cache',async()=>{
  let finishFirst;const requests=[];
  const read=createMarketReader(async(url,options)=>{
    requests.push({url,options});
    if(requests.length===1)return new Promise(resolve=>{finishFirst=resolve;});
    if(requests.length===2)return new Response(JSON.stringify(bundle),{headers:{ETag:'"second"'}});
    return new Response(null,{status:304});
  });
  const delayed=read('/first');await read('/second');
  finishFirst(new Response(JSON.stringify(bundle),{headers:{ETag:'"first"'}}));await delayed;
  await read('/second');assert.equal(requests[2].options.headers['If-None-Match'],'"second"');
});
test('invalid responses do not replace a valid cached bundle',async()=>{
  const responses=[new Response(JSON.stringify(bundle),{headers:{ETag:'"good"'}}),new Response('{"schema_version":1}',{headers:{ETag:'"bad"'}}),new Response(null,{status:304})],requests=[];
  const read=createMarketReader(async(url,options)=>{requests.push(options);return responses.shift();});
  const first=await read('/api/market');
  await assert.rejects(read('/api/market'),/Unsupported/);
  assert.equal(await read('/api/market'),first);assert.equal(requests[2].headers['If-None-Match'],'"good"');
});
test('an orphan 304 and actual failed request are errors, not fresh successes',async()=>{
  await assert.rejects(createMarketReader(async()=>new Response(null,{status:304}))('/api/market',{sameOrigin:true}),/without a prior/);
  await assert.rejects(createMarketReader(async()=>new Response('unavailable',{status:503}))('/api/market',{sameOrigin:true}),/HTTP 503/);
});

const evidence={schema_version:2,by_symbol:{SPY:{stats_id:'baseline-one'}}};
test('unchanged public evidence uses 304 without downloading or parsing its body again',async()=>{
  const requests=[],responses=[new Response(JSON.stringify(evidence),{headers:{ETag:'"evidence-one"'}}),new Response(null,{status:304})];
  const read=createEvidenceReader(async(url,options)=>{requests.push(options);return responses.shift();});
  const url=marketEndpoints('carterwaynereed.github.io').evidence;
  const first=await read(url),second=await read(url);
  assert.equal(first,second);assert.equal(requests[1].headers['If-None-Match'],'"evidence-one"');
  assert.ok(requests.every(r=>r.credentials==='omit'));
});
test('evidence validates the ticker map before replacing retained evidence',async()=>{
  const requests=[],responses=[new Response(JSON.stringify(evidence),{headers:{ETag:'"valid"'}}),new Response(JSON.stringify({schema_version:2,by_symbol:[]}),{headers:{ETag:'"invalid"'}}),new Response(null,{status:304})];
  const read=createEvidenceReader(async(url,options)=>{requests.push(options);return responses.shift();});
  const first=await read('/api/evidence',{sameOrigin:true});
  await assert.rejects(read('/api/evidence',{sameOrigin:true}),/Unsupported ticker evidence/);
  assert.equal(await read('/api/evidence',{sameOrigin:true}),first);
  assert.equal(requests[2].headers['If-None-Match'],'"valid"');
});
test('evidence errors stay explicit and a different URL cannot reuse a cached body',async()=>{
  await assert.rejects(createEvidenceReader(async()=>new Response(null,{status:304}))('/api/evidence'),/without a prior/);
  await assert.rejects(createEvidenceReader(async()=>new Response('unavailable',{status:503}))('/api/evidence'),/HTTP 503/);
  const responses=[new Response(JSON.stringify(evidence),{headers:{ETag:'"first"'}}),new Response(null,{status:304})],requests=[];
  const read=createEvidenceReader(async(url,options)=>{requests.push(options);return responses.shift();});
  await read('/api/evidence');await assert.rejects(read('https://different.example/api/evidence'),/without a prior/);
  assert.deepEqual(requests[1].headers,{});
  for(const value of [{schema_version:9,by_symbol:{}},{schema_version:1,by_symbol:null},{schema_version:2,by_symbol:{}},{schema_version:2,by_symbol:{SPY:null}}])await assert.rejects(createEvidenceReader(async()=>new Response(JSON.stringify(value)))('/api/evidence'),/Unsupported ticker evidence/);
});
