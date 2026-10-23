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
const assets={'/index.html':{type:'text/html; charset=utf-8',body:'<h1>Saty+ test</h1>'},'/assets/app.js':{type:'text/javascript',body:'// public asset'}};
const worker=createWorker(assets,readHosted,writeHosted);
const request=(path,opts={})=>new Request('https://desk.example'+path,opts);
const value=()=>({generatedAt:new Date(Date.now()-1000).toISOString(),feeds:{symbols:{SPY:{bars:[],daily:[]}}},context:{activeSymbols:['SPY']},journal:[{id:'test-paper-only',status:'closed',r:1}]});

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
  const response=await worker.fetch(request('/api/update',{method:'POST',headers:{'Content-Type':'application/json','X-Saty-Update':'1'},body:JSON.stringify(data)}),{BUCKET:bucket});
  assert.equal(response.status,200);assert.equal((await response.json()).saved,true);
  assert.equal(bucket.lastKey,SNAPSHOT_KEY);assert.equal(SNAPSHOT_KEY,'saty-plus/desk-v1.json');
  const read=await worker.fetch(request('/api/snapshot'),{BUCKET:bucket});
  assert.match(read.headers.get('Cache-Control'),/private, no-store/);
  const saved=await read.json();assert.deepEqual(saved.journal,data.journal);assert.equal(saved.mode,'hosted');assert.equal(saved.paperEntryMode,'scheduled');
  assert.equal(saved.analyses[0].decision,'WAIT');
});
test('Browser writes and oversized service payloads are rejected before touching storage',async()=>{
  let writes=0;
  const guarded=createWorker(assets,async()=>null,async()=>{writes++;return {};});
  const options={method:'POST',headers:{'Content-Type':'application/json','X-Saty-Update':'1','Origin':'https://desk.example'},body:'{}'};
  assert.equal((await guarded.fetch(request('/api/update',options),{BUCKET:{}})).status,403);
  delete options.headers.Origin;options.body=' '.repeat(2000001);
  assert.equal((await guarded.fetch(request('/api/update',options),{BUCKET:{}})).status,413);
  assert.equal(writes,0);
});
test('Missing or failed private storage reports unavailability without invented empty journal',async()=>{
  assert.equal((await worker.fetch(request('/api/snapshot'),{})).status,503);
  const failed=createWorker(assets,async()=>{throw new Error('internal backend detail');},writeHosted);
  const response=await failed.fetch(request('/api/snapshot'),{BUCKET:{}});
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/internal backend detail/);
});
