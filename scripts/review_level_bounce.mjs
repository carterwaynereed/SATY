// Isolated measurement; no alteration to the MAIN decision / WAIT ledger.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildLiveSnapshot} from '../lib/saty-live.mjs';
import {bounceReferences,replayBounce,BOUNCE_VERSION,BOUNCE_REPORTED} from '../lib/level-bounce.mjs';
import {retestStats} from '../lib/trigger-retest-shadow.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d,state=resolve(opt('--state-dir','.dashboard-state/state')),now=Date.parse(opt('--now',new Date().toISOString()));
const calendar=JSON.parse(await readFile(new URL('../hosting/session-calendar.json',import.meta.url))),events=JSON.parse(await readFile(new URL('../hosting/bounce-events.json',import.meta.url))),registration=JSON.parse(await readFile(new URL('../learning/level-bounce-live.json',import.meta.url)));
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
let days=[];try{days=(await readdir(join(state,'bars'))).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
const dir=join(state,'level-bounce'),records=[],errors=[];await mkdir(join(dir,'sessions'),{recursive:true});
for(const day of days)for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
 const a=await read(join(state,'bars',day,symbol+'.json'));if(!a||Date.parse(a.session.open)<=Date.parse(registration.registered_at)||Date.parse(a.session.open)>now)continue;
 const context=await read(join(state,'pullback-vix','context',day+'.json'));
 try{const snapshot=buildLiveSnapshot(a,null,calendar,Math.min(now,Date.parse(a.session.close)+10000)),ref=bounceReferences(a,snapshot,calendar),x=replayBounce(snapshot,{reference:ref,overnight:context?.overnight?.[symbol],vix:context?.vix,events,calendar},{now});
  for(const t of x.trades){const key=new Date(Date.parse(t.decision_at)-180000).toISOString(),seen=a.first_seen?.[key]??a.first_received_at,vseen=context?.vix?.first_seen?.[new Date(Date.parse(t.vix.bar_close)-180000).toISOString()];t.observation_kind=Date.parse(seen)>=Date.parse(t.decision_at)&&Date.parse(seen)-Date.parse(t.decision_at)<=225000&&Date.parse(vseen)>=Date.parse(t.vix.bar_close)&&Date.parse(vseen)-Date.parse(t.decision_at)<=225000?'OBSERVED':'REPLAY_LATE';}
  const record={day,symbol,source_fingerprint:a.source.feed_fingerprint,...x};records.push(record);await writeFile(join(dir,'sessions',day+'-'+symbol+'.json'),JSON.stringify(record)+'\n');
 }catch(e){errors.push({day,symbol,reason:e.message});}
}
const by_symbol={};for(const symbol of ['SPY','SPX','AAPL','GOOGL']){const own=records.filter(r=>r.symbol===symbol),ts=own.flatMap(r=>r.trades);by_symbol[symbol]={sessions:own.length,observed:retestStats(ts.filter(t=>t.observation_kind==='OBSERVED')),replay_late:retestStats(ts.filter(t=>t.observation_kind==='REPLAY_LATE')),data_hold_bars:own.flatMap(r=>r.decisions).filter(d=>d.reason.startsWith('DATA HOLD')).length};}
await writeFile(join(dir,'evidence.json'),JSON.stringify({schema_version:1,version:BOUNCE_VERSION,signal_only:true,updated_at:new Date(now).toISOString(),reported:BOUNCE_REPORTED,by_symbol,errors})+'\n');console.log(JSON.stringify({version:BOUNCE_VERSION,sessions:records.length,errors_n:errors.length}));
