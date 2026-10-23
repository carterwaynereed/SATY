import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../hosting/worker.mjs';
import {readHosted,writeHosted,SNAPSHOT_KEY} from '../lib/hosted-snapshot.mjs';

class Bucket {
  value=null;etag='0';lastKey=null;
  async get(key){this.lastKey=key;return this.value?{etag:this.etag,json:async()=>JSON.parse(this.value)}:null;}
  async put(key,value,options){
    this.lastKey=key;
    if(options.onlyIf.etagMatches&&options.onlyIf.etagMatches!==this.etag)return null;
    this.value=value;this.etag=String(Number(this.etag)+1);return {etag:this.etag};
  }
}
const evidenceBody=JSON.stringify({schema_version:2,by_symbol:{SPY:{stats_id:'public-test-evidence'}}});
const assets={'/index.html':{type:'text/html; charset=utf-8',body:'<h1>Saty+ test</h1>'},'/assets/app.js':{type:'text/javascript',body:'// public asset'},'/data/tv-evidence.json':{type:'application/json',body:evidenceBody}};
const worker=createWorker(assets,readHosted,writeHosted);
const request=(path,opts={})=>new Request('https://desk.example'+path,opts);
const value=()=>({generatedAt:new Date(Date.now()-1000).toISOString(),feeds:{symbols:{SPY:{bars:[],daily:[]}}},context:{activeSymbols:['SPY']},journal:[{id:'test-paper-only',status:'closed',r:1}]});
// Deliberately synthetic credentials used only by this test fixture.
const serviceKey='a'.repeat(64),pagesOrigin='https://carterwaynereed.github.io';
const serviceHeaders={'X-Saty-Journal-Authorization':'Bearer '+serviceKey};
const ownerHeaders={'oai-authenticated-user-id':'site-scoped-owner-id','oai-authenticated-user-email':'Owner@Example.test'};
const configured={SATY_JOURNAL_SERVICE_KEY:serviceKey,SATY_JOURNAL_OWNER_EMAIL:'owner@example.test'};

test('Worker serves public assets and cannot expose filesystem or private records as assets',async()=>{
  const response=await worker.fetch(request('/'),{});
  assert.equal(response.status,200);assert.match(await response.text(),/Saty/);
  assert.match(response.headers.get('Content-Security-Policy'),/raw\.githubusercontent\.com/);
  for(const path of ['/data/journal.json','/.env','/engine/sig2.py','/api/orders'])assert.equal((await worker.fetch(request(path),{})).status,404);
  assert.equal((await worker.fetch(request('/',{method:'POST'}),{})).status,405);
  assert.equal(await (await worker.fetch(request('/',{method:'HEAD'}),{})).text(),'');
});
test('Private storage contract survives framework removal and uses the unchanged journal key',async()=>{
  const bucket=new Bucket(),data=value();
  const env={...configured,BUCKET:bucket};
  const response=await worker.fetch(request('/api/update',{method:'POST',headers:{...serviceHeaders,'Content-Type':'application/json','X-Saty-Update':'1'},body:JSON.stringify(data)}),env);
  assert.equal(response.status,200);assert.equal((await response.json()).saved,true);
  assert.equal(bucket.lastKey,SNAPSHOT_KEY);assert.equal(SNAPSHOT_KEY,'saty-plus/desk-v1.json');
  const read=await worker.fetch(request('/api/snapshot',{headers:serviceHeaders}),env);
  assert.match(read.headers.get('Cache-Control'),/private, no-store/);
  const saved=await read.json();assert.deepEqual(saved.journal,data.journal);assert.equal(saved.mode,'hosted');assert.equal(saved.paperEntryMode,'scheduled');
  assert.equal(saved.analyses[0].decision,'WAIT');
  const ownerRead=await worker.fetch(request('/api/snapshot',{headers:ownerHeaders}),env);
  assert.equal(ownerRead.status,200);assert.deepEqual((await ownerRead.json()).journal,data.journal);
});
test('Browser writes and oversized service payloads are rejected before touching storage',async()=>{
  let writes=0;
  const guarded=createWorker(assets,async()=>null,async()=>{writes++;return {};});
  const options={method:'POST',headers:{...serviceHeaders,'Content-Type':'application/json','X-Saty-Update':'1','Origin':'https://desk.example'},body:'{}'};
  assert.equal((await guarded.fetch(request('/api/update',options),{...configured,BUCKET:{}})).status,403);
  delete options.headers.Origin;options.body=' '.repeat(2000001);
  assert.equal((await guarded.fetch(request('/api/update',options),{...configured,BUCKET:{}})).status,413);
  assert.equal(writes,0);
});
test('Missing or failed private storage reports unavailability without invented empty journal',async()=>{
  assert.equal((await worker.fetch(request('/api/snapshot',{headers:serviceHeaders}),configured)).status,503);
  const failed=createWorker(assets,async()=>{throw new Error('internal backend detail');},writeHosted);
  const response=await failed.fetch(request('/api/snapshot',{headers:serviceHeaders}),{...configured,BUCKET:{}});
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/internal backend detail/);
});
test('Public audience cannot read or mutate private records without separate authorization',async()=>{
  let reads=0,writes=0;
  const guarded=createWorker(assets,async()=>{reads++;return {journal:['PRIVATE']};},async()=>{writes++;return {};});
  const env={...configured,BUCKET:{}};
  const cases=[
    [{},401],
    [{'OAI-Sites-Authorization':'Bearer platform-bypass-is-not-journal-auth'},401],
    [{'X-Saty-Journal-Authorization':'Bearer '+'b'.repeat(64)},403],
    [{'X-Saty-Journal-Authorization':'Bearer '+serviceKey+'extra'},403],
    [{'oai-authenticated-user-id':'other-user','oai-authenticated-user-email':'other@example.test'},403],
    [{'oai-authenticated-user-email':'owner@example.test'},403],
    [{'oai-authenticated-user-id':'site-scoped-owner-id'},403]
  ];
  for(const [headers,status] of cases){
    for(const [path,options] of [['/api/snapshot',{headers}],['/api/update',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Saty-Update':'1'},body:'{}'}]]){
      const response=await guarded.fetch(request(path,options),env);
      assert.equal(response.status,status);assert.doesNotMatch(await response.text(),/PRIVATE/);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
    }
  }
  // Owner identity grants read-only access, never updater privileges.
  const ownerWrite=await guarded.fetch(request('/api/update',{method:'POST',headers:{...ownerHeaders,'Content-Type':'application/json','X-Saty-Update':'1'},body:'{}'}),env);
  assert.equal(ownerWrite.status,403);
  // Missing runtime configuration must fail closed even with plausible headers.
  assert.equal((await guarded.fetch(request('/api/snapshot',{headers:ownerHeaders}),{BUCKET:{}})).status,403);
  assert.equal((await guarded.fetch(request('/api/snapshot',{headers:serviceHeaders}),{BUCKET:{}})).status,403);
  assert.equal(reads,0);assert.equal(writes,0);
});
test('Only public evidence and market routes permit the exact Pages origin',async()=>{
  const response=await worker.fetch(request('/api/evidence',{headers:{Origin:pagesOrigin}}),{});
  assert.equal(response.status,200);assert.equal(await response.text(),evidenceBody);
  const etag=response.headers.get('ETag');assert.ok(etag);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),pagesOrigin);
  assert.equal(response.headers.get('Access-Control-Expose-Headers'),'ETag');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  assert.equal(response.headers.get('Vary'),'Origin');
  const unchanged=await worker.fetch(request('/api/evidence',{headers:{Origin:pagesOrigin,'If-None-Match':etag}}),{});
  assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
  assert.equal(unchanged.headers.get('Access-Control-Allow-Origin'),pagesOrigin);
  const head=await worker.fetch(request('/api/evidence',{method:'HEAD',headers:{Origin:pagesOrigin}}),{});
  assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('ETag'),etag);
  for(const path of ['/api/evidence','/api/market']){
    const preflight=await worker.fetch(request(path,{method:'OPTIONS',headers:{Origin:pagesOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'If-None-Match'}}),{});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),pagesOrigin);
    assert.equal(preflight.headers.get('Access-Control-Allow-Headers'),'If-None-Match');
    assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
    for(const headers of [{Origin:'https://unrelated.example','Access-Control-Request-Method':'GET'},{Origin:pagesOrigin,'Access-Control-Request-Method':'POST'},{Origin:pagesOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-Saty-Journal-Authorization'}]){
      const denied=await worker.fetch(request(path,{method:'OPTIONS',headers}),{});
      assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
    }
  }
  for(const path of ['/api/evidence','/data/tv-evidence.json','/','/api/snapshot','/api/update']){
    const headers={Origin:path==='/api/evidence'?'https://unrelated.example':pagesOrigin};
    assert.equal((await worker.fetch(request(path,{headers}),configured)).headers.get('Access-Control-Allow-Origin'),null);
  }
  const unavailable=await worker.fetch(request('/api/market',{headers:{Origin:pagesOrigin}}),{});
  assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('Access-Control-Allow-Origin'),pagesOrigin);
});
