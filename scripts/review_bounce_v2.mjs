import {intervalIndicators} from '../lib/level-bounce-v2-filters.mjs';
// Isolated measurement; no alteration to the MAIN decision / WAIT ledger.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildLiveSnapshot} from '../lib/saty-live.mjs';
import {bounceReferences,replayBounce,BOUNCE_VERSION} from '../lib/level-bounce-v2-engine.mjs';
import {retestStats} from '../lib/trigger-retest-shadow.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d,state=resolve(opt('--state-dir','.dashboard-state/state')),now=Date.parse(opt('--now',new Date().toISOString()));
const calendar=JSON.parse(await readFile(new URL('../hosting/session-calendar.json',import.meta.url))),events=JSON.parse(await readFile(new URL('../hosting/bounce-events.json',import.meta.url))),registration=JSON.parse(await readFile(new URL('../learning/level-bounce-v2-shadow.json',import.meta.url)));
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
let days=[];try{days=(await readdir(join(state,'bars'))).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
const dir=join(state,'level-bounce-v2'),records=[],errors=[];await mkdir(join(dir,'sessions'),{recursive:true});
for(const day of days)for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
 const a=await read(join(state,'bars',day,symbol+'.json'));if(!a||Date.parse(a.session.open)<=Date.parse(registration.registered_at)||Date.parse(a.session.open)>now)continue;
 const context=await read(join(state,'pullback-vix','context',day+'.json')),extra=await read(join(state,'level-bounce-v2','context',day+'.json'));
 const configPath=join(dir,'sessions',day+'-key.json'),priorKey=await read(configPath),candidateKey={default_vix_key:registration.default_vix_key,daily_keys:{[day]:registration.daily_keys?.[day]}};
 // First measured session freezes its key settings for later deterministic reviews.
 const keyConfig=priorKey??candidateKey;if(!priorKey)await writeFile(configPath,JSON.stringify(candidateKey)+'\n');
 const five=extra?.series?.VIX5,hour=extra?.series?.[symbol],same=(x,y)=>x?.source_id&&x.source_id===y?.source_id&&(x.pro_name??x.symbol)===(y.pro_name??y.symbol);
 const v2={config:keyConfig,vix5:same(five?.source,context?.vix?.source)?intervalIndicators(five.bars,5,calendar):[],hour:same(hour?.source,a.source)?intervalIndicators(hour.bars,60,calendar):[]};
 try{const snapshot=buildLiveSnapshot(a,null,calendar,Math.min(now,Date.parse(a.session.close)+10000)),ref=bounceReferences(a,snapshot,calendar),x=replayBounce(snapshot,{reference:ref,overnight:context?.overnight?.[symbol],vix:context?.vix,events,calendar,v2},{now});
  for(const t of x.trades){const key=new Date(Date.parse(t.decision_at)-180000).toISOString(),seen=a.first_seen?.[key]??a.first_received_at,vseen=context?.vix?.first_seen?.[new Date(Date.parse(t.vix.bar_close)-180000).toISOString()];const f=t.v2_filter,findSeen=(series,at)=>{const b=series?.bars?.find(b=>{const row=intervalIndicators([b],series===five?5:60,calendar)[0];return row?.known_at===at;});return series?.first_seen?.[b?.time];},fiveSeen=findSeen(five,f?.vix5_at),hourSeen=t.side===-1?findSeen(hour,f?.hour_at):null;
   t.shadow_only=true;t.eligible_for_execution=false;t.observation_kind=Date.parse(seen)>=Date.parse(t.decision_at)&&Date.parse(seen)-Date.parse(t.decision_at)<=225000&&Date.parse(vseen)>=Date.parse(t.vix.bar_close)&&Date.parse(vseen)-Date.parse(t.decision_at)<=225000&&Date.parse(fiveSeen)>=Date.parse(f.vix5_at)&&Date.parse(fiveSeen)-Date.parse(t.decision_at)<=225000&&(t.side===1||Date.parse(hourSeen)>=Date.parse(f.hour_at)&&Date.parse(hourSeen)-Date.parse(t.decision_at)<=225000)?'OBSERVED':'REPLAY_LATE';}
  const record={day,symbol,key_config:keyConfig,shadow_only:true,hidden_from_ui:true,eligible_for_execution:false,source_fingerprint:a.source.feed_fingerprint,...x};records.push(record);await writeFile(join(dir,'sessions',day+'-'+symbol+'.json'),JSON.stringify(record)+'\n');
 }catch(e){errors.push({day,symbol,reason:e.message});}
}
const by_symbol={};for(const symbol of ['SPY','SPX','AAPL','GOOGL']){const own=records.filter(r=>r.symbol===symbol),ts=own.flatMap(r=>r.trades);by_symbol[symbol]={sessions:own.length,observed:retestStats(ts.filter(t=>t.observation_kind==='OBSERVED')),replay_late:retestStats(ts.filter(t=>t.observation_kind==='REPLAY_LATE')),data_hold_bars:own.flatMap(r=>r.decisions).filter(d=>d.reason.startsWith('DATA HOLD')).length};}
await writeFile(join(dir,'evidence.json'),JSON.stringify({schema_version:1,version:BOUNCE_VERSION,signal_only:true,shadow_only:true,hidden_from_ui:true,eligible_for_execution:false,updated_at:new Date(now).toISOString(),reported:registration.reported_walk_forward,by_symbol,errors})+'\n');console.log(JSON.stringify({version:BOUNCE_VERSION,sessions:records.length,errors_n:errors.length}));
