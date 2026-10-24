// Anonymous production verification. No cookies, access keys or private rows.
// Node may need --use-env-proxy in a managed network environment.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const home='https://saty-plus-trading-desk.zestyfawn9.chatgpt.site';
const pages='https://carterwaynereed.github.io/SATY/';
const origin=new URL(pages).origin;
const request=(url,options={})=>fetch(url,{redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000),...options});
const hash=value=>createHash('sha256').update(value).digest('hex');
const checkCORS=response=>{
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(response.headers.get('access-control-allow-credentials'),null);
  assert.match(response.headers.get('vary')||'',/origin/i);
  assert.match(response.headers.get('access-control-expose-headers')||'',/etag/i);
};
const index=await request(home+'/');
assert.equal(index.status,200,'Anonymous home must open without a sign-in redirect');
const html=await index.text();
assert.match(html,/Momentum Tracker/i);
for(const id of ['momentum-card','chart','levels','indicator-summary','signals','journal','learning'])assert.ok(html.includes('id=\"'+id+'\"'),'Restored panel missing: '+id);
const routes={};let market;
for(const route of ['/api/market','/api/evidence']){
  const response=await request(home+route,{headers:{Origin:origin}});
  assert.equal(response.status,200,route+' must be public');checkCORS(response);
  const body=await response.text(),value=JSON.parse(body),etag=response.headers.get('etag');
  assert.ok(etag);assert.equal(Object.keys(value.symbols??value.by_symbol??{}).length,4);
  if(route==='/api/market')market=value;
  if(route==='/api/evidence')assert.equal(hash(body),hash(await readFile(new URL('../site/data/tv-evidence.json',import.meta.url),'utf8')));
  const unchanged=await request(home+route,{headers:{Origin:origin,'If-None-Match':etag}});
  assert.ok([200,304].includes(unchanged.status));checkCORS(unchanged);
  if(unchanged.status===200)assert.notEqual(unchanged.headers.get('etag'),etag,'An unchanged representation should return 304');
  await unchanged.body?.cancel();
  const preflight=await request(home+route,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'If-None-Match'}});
  assert.equal(preflight.status,204);checkCORS(preflight);
  assert.match(preflight.headers.get('access-control-allow-headers')||'',/if-none-match/i);
  routes[route]={status:response.status,conditional:unchanged.status,preflight:preflight.status,bytes:Buffer.byteLength(body),sha256:hash(body)};
}
const denied={};
for(const [route,options] of [
  ['/api/snapshot',{}],
  ['/api/update',{method:'POST',headers:{'Content-Type':'application/json','X-Saty-Update':'1'},body:'{}'}]
]){
  const response=await request(home+route,options);
  assert.ok([401,403].includes(response.status),'Anonymous private route must be denied: '+route);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  const body=await response.json();assert.ok(body.error);assert.equal(body.journal,undefined);
  denied[route]=response.status;
}
const wrongOrigin=await request(home+'/api/market',{headers:{Origin:'https://example.invalid'}});
assert.equal(wrongOrigin.headers.get('access-control-allow-origin'),null);await wrongOrigin.body?.cancel();
const paths=['index.html','desk.mjs','momentum-dashboard.mjs','assets/momentum.css','assets/dashboard.css','details.html','assets/app.js'];
const assets=await Promise.all(paths.map(async path=>{
  const response=await request(home+'/'+path);assert.equal(response.status,200,path);
  const remote=await response.text(),local=await readFile(new URL('../site/'+path,import.meta.url),'utf8');
  assert.equal(hash(remote),hash(local),'Deployed asset differs: '+path);
  return path;
}));
const mirror=await request(pages),pagesStatus=mirror.status;
const pagesChecks={status:pagesStatus,enabled:pagesStatus===200,matching_assets:[]};
if(pagesStatus===200){
  await mirror.body?.cancel();
  for(const path of paths){
    const response=await request(pages+path);assert.equal(response.status,200);
    const remote=await response.text(),local=await readFile(new URL('../site/'+path,import.meta.url),'utf8');
    assert.equal(hash(remote),hash(local),'Pages asset differs: '+path);pagesChecks.matching_assets.push(path);
  }
}else{
  await mirror.body?.cancel();
  if(process.argv.includes('--require-pages'))assert.fail('Pages is not enabled or deployed: HTTP '+pagesStatus);
}
console.log(JSON.stringify({verified_at:new Date().toISOString(),anonymous_home_status:index.status,public_url:home+'/',routes,private_denials:denied,matching_assets:assets,pages:pagesChecks,market_generated_at:market.generated_at,symbols:Object.fromEntries(Object.entries(market.symbols).map(([symbol,v])=>[symbol,{price:v.market?.last,last_bar:v.health?.price_asof,state:v.health?.state,call:v.evidence_weights?.call,put:v.evidence_weights?.put,wait:v.evidence_weights?.wait}]))}));
