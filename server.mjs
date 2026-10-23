import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {root,snapshot,scan,saveJSON,readJSON,makeTrade,withDataLock} from './scan.mjs';
import {eastern} from './site/engine.mjs';
const port=Number(process.env.SATY_PORT||8765),origin=`http://127.0.0.1:${port}`;
const assetPath=url=>url==='/'?'index.html':/^\/(?:index\.html|engine\.mjs|desk\.mjs|sources\.json|assets\/[a-zA-Z0-9._-]+|data\/(?:latest|evidence|uw|learning)\.json)$/.test(url)?url.slice(1):null;
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
let writing=Promise.resolve();
const server=http.createServer(async(req,res)=>{
 const send=(code,data,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(typeof data==='string'?data:JSON.stringify(data));};
 try{
  if(req.headers.host!==`127.0.0.1:${port}`)return send(403,{error:'Unrecognized local host'});
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&url.pathname==='/api/snapshot')return send(200,await snapshot());
  if(req.method==='POST'){
   if(req.headers.origin!==origin||!String(req.headers['content-type']).startsWith('application/json'))return send(403,{error:'Use this dashboard to make changes'});
   let raw='';for await(const c of req){raw+=c;if(raw.length>20000)return send(413,{error:'Request too large'});}const body=JSON.parse(raw||'{}');
   if(url.pathname==='/api/paper'){
    const operation=writing.then(()=>withDataLock(async()=>{const now=Date.now(),s=await snapshot(now),a=s.analyses.find(x=>x.symbol===body.symbol);if(!a||a.decision==='WAIT')throw new Error('Setup unavailable or expired');if(s.journal.some(t=>['pending','open','unresolved'].includes(t.status)))throw new Error('Resolve the existing paper trade first');if(s.journal.filter(t=>eastern(t.createdAt).date===eastern(now).date&&t.status!=='cancelled').length>=5)throw new Error('Five-entry daily paper cap reached');if(s.journal.some(t=>t.symbol===a.symbol&&Date.parse(t.createdAt)>now-600000))throw new Error('Ten-minute paper cooldown');const trade=makeTrade(a,now);await saveJSON('journal.json',[...s.journal,trade]);return trade;}));writing=operation.catch(()=>{});return send(200,await operation);
   }
   if(url.pathname==='/api/context'){
    if(typeof body.eventSource!=='string'||!/^https:\/\//.test(body.eventSource)||!Array.isArray(body.events)||body.events.length>30||body.events.some(e=>typeof e.name!=='string'||e.name.length>200||!Number.isFinite(Date.parse(e.at))||!['high','medium','low'].includes(e.impact)))return send(400,{error:'Supply a source URL and valid dated event list'});
    const op=writing.then(async()=>saveJSON('context.json',{...await readJSON('context.json',{}),eventsReviewedAt:new Date().toISOString(),eventSource:body.eventSource,events:body.events}));writing=op.catch(()=>{});await op;return send(200,{saved:true});
   }
   return send(404,{error:'Unknown action'});
  }
  if(req.method==='GET'&&assetPath(url.pathname)){const file=assetPath(url.pathname);return send(200,await readFile(path.join(root,'site',file),'utf8'),types[path.extname(file)]);}
  send(404,{error:'Not found'});
 }catch(e){send(400,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Saty+ local desk: ${origin}`));
