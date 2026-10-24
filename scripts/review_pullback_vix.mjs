import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {shadowRows,replayPullback,VERSION} from '../lib/pullback-vix-shadow.mjs';
import {retestStats} from '../lib/trigger-retest-shadow.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const state=resolve(opt('--state-dir','.dashboard-state/state')),dir=join(state,'pullback-vix'),now=Date.parse(opt('--now',new Date().toISOString()));
const config=JSON.parse(await readFile(new URL('../learning/pullback-vix-shadow.json',import.meta.url),'utf8'));
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
let days=[];try{days=(await readdir(join(state,'bars'))).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
const records=[],errors=[];await mkdir(join(dir,'sessions'),{recursive:true});
for(const day of days)for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
 const feed=await read(join(state,'bars',day,symbol+'.json'));if(!feed||Date.parse(feed.session.open)<=Date.parse(config.registered_at)||Date.parse(feed.session.open)>now)continue;
 const context=await read(join(dir,'context',day+'.json'));
 try{
  const confirmed={...feed,bars:feed.bars.filter(b=>Date.parse(b.time)+180000<=now)};
  const {rows,levels}=shadowRows(confirmed,feed.session);
  const own=rows.filter(r=>Date.parse(r.bar_open)>=Date.parse(feed.session.open));
  if(own.some((r,i)=>Date.parse(r.bar_open)!==Date.parse(feed.session.open)+i*180000))throw Error('Incomplete RTH prefix');
  const x=replayPullback(own,{levels,session:feed.session,vix:context?.vix,overnight:context?.overnight?.[symbol]},{now,minutes:feed.one_bars??[]});
  for(const t of x.trades){const key=new Date(Date.parse(t.decision_at)-180000).toISOString(),seen=feed.first_seen?.[key]??feed.first_received_at,vseen=context?.vix?.first_seen?.[new Date(Date.parse(t.vix.bar_close)-180000).toISOString()],delay=Date.parse(seen)-Date.parse(t.decision_at),vd=Date.parse(vseen)-Date.parse(t.decision_at);t.observation_kind=delay>=0&&delay<=225000&&Date.parse(vseen)>=Date.parse(t.vix.bar_close)&&vd<=225000?'OBSERVED':'REPLAY_LATE';t.first_observed_at=seen;}
  const record={day,symbol,source_fingerprint:feed.source.feed_fingerprint,...x};records.push(record);
  await writeFile(join(dir,'sessions',day+'-'+symbol+'.json'),JSON.stringify(record)+'\n');
 }catch(e){errors.push({day,symbol,reason:e.message});}
}
const by_symbol={};for(const symbol of ['SPY','SPX','AAPL','GOOGL']){const own=records.filter(r=>r.symbol===symbol),ts=own.flatMap(r=>r.trades);by_symbol[symbol]={sessions:own.length,observed:retestStats(ts.filter(t=>t.observation_kind==='OBSERVED')),replay_late:retestStats(ts.filter(t=>t.observation_kind==='REPLAY_LATE')),data_hold_bars:own.flatMap(r=>r.decisions).filter(d=>d.reason.startsWith('DATA HOLD')).length};}
const result={schema_version:1,version:VERSION,shadow_only:true,hidden_from_ui:true,eligible_for_execution:false,updated_at:new Date(now).toISOString(),registered_at:config.registered_at,by_symbol,errors,reported:config.reported_walk_forward};
await writeFile(join(dir,'evidence.json'),JSON.stringify(result)+'\n');console.log(JSON.stringify({version:VERSION,sessions:records.length,errors_n:errors.length}));
