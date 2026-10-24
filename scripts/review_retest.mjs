// First-observed and replay-late outcomes remain separate; no claimed live fills.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {policyContext} from '../lib/approved-policy.mjs';
import {retestStats,RETEST_VERSION,SUITE_VERSION} from '../site/trigger-retest.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const state=resolve(opt('--state-dir','.dashboard-state/state')),data=resolve(opt('--data-dir','site/data')),now=Date.parse(opt('--now',new Date().toISOString()));
const config=JSON.parse(await readFile(new URL('../site/data/retest-config.json',import.meta.url),'utf8'));
let days=[];try{days=(await readdir(join(state,'bars'))).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
const records=[],errors=[];await mkdir(join(state,'retest','sessions'),{recursive:true});
for(const day of days)for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
 let a;try{a=JSON.parse(await readFile(join(state,'bars',day,symbol+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const open=Date.parse(a.session.open),close=Date.parse(a.session.close);if(open<=Date.parse(config.registered_at)||open>now)continue;
 const cache=join(state,'retest','sessions',day+'-'+symbol+'.json');let cached=null;try{cached=JSON.parse(await readFile(cache,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(close<=now&&cached?.version===RETEST_VERSION&&cached.registered_at===config.registered_at&&cached.source_fingerprint===a.source.feed_fingerprint){records.push(...cached.records);continue;}
 const bars=a.bars.filter(b=>Date.parse(b.time)>=open&&Date.parse(b.time)+180000<=Math.min(now,close)).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)),expected=Math.floor((Math.min(close,now)-open)/180000);
 if(!bars.length)continue;
 if((close<=now?bars.length!==expected:bars.length<expected-1||now-Date.parse(bars.at(-1).time)-180000>225000)||bars.some((b,i)=>Date.parse(b.time)!==open+i*180000)){errors.push({day,symbol,reason:'Incomplete RTH session'});continue;}
 try{const sessionRecords=[];const p=policyContext(a,a.session,Math.min(now,close+10000));for(const [mode,x] of [['fixed',p.dualFixed],['runner',p.dualRunner]]){
  const annotate=t=>{const key=new Date(Date.parse(t.decision_at)-180000).toISOString(),seen=a.first_seen?.[key]??a.first_received_at,delay=Date.parse(seen)-Date.parse(t.decision_at);return {...t,version:RETEST_VERSION,mode,first_observed_at:seen,observation_kind:delay>=0&&delay<=225000?'OBSERVED':'REPLAY_LATE'};};const trades=x.retest.trades.map(annotate),main_trades=x.main.trades.map(annotate);
  sessionRecords.push({day,symbol,mode,source_fingerprint:a.source.feed_fingerprint,trades,main_trades});
 }records.push(...sessionRecords);if(close<=now&&sessionRecords.every(r=>[...r.trades,...r.main_trades].every(t=>t.status==='CLOSED'&&!t.time_exit_pending)))await writeFile(cache,JSON.stringify({version:RETEST_VERSION,registered_at:config.registered_at,source_fingerprint:a.source.feed_fingerprint,records:sessionRecords})+'\n');}catch(e){errors.push({day,symbol,reason:e.message});}
}
const by_symbol={};for(const symbol of ['SPY','SPX','AAPL','GOOGL']){by_symbol[symbol]={};for(const mode of ['fixed','runner']){
 const own=records.filter(r=>r.symbol===symbol&&r.mode===mode),trades=own.flatMap(r=>r.trades),main=own.flatMap(r=>r.main_trades);
 by_symbol[symbol][mode]={sessions:own.length,observed:retestStats(trades.filter(t=>t.observation_kind==='OBSERVED')),replay_late:retestStats(trades.filter(t=>t.observation_kind==='REPLAY_LATE')),main:{observed:retestStats(main.filter(t=>t.observation_kind==='OBSERVED')),replay_late:retestStats(main.filter(t=>t.observation_kind==='REPLAY_LATE'))}};
}}
const result={schema_version:1,version:RETEST_VERSION,suite_version:SUITE_VERSION,updated_at:new Date(now).toISOString(),registered_at:config.registered_at,by_symbol,errors,reported:config.reported_walk_forward,note:'App-observed sample and replay-late sample are separate from the user-supplied walk-forward n=64. No broker execution or calibrated live probability.'};
await mkdir(data,{recursive:true});await mkdir(join(state,'retest'),{recursive:true});await writeFile(join(data,'retest-evidence.json'),JSON.stringify(result)+'\n');await writeFile(join(state,'retest','review.json'),JSON.stringify({...result,records})+'\n');console.log(JSON.stringify({version:RETEST_VERSION,records_n:records.length,errors_n:errors.length}));
