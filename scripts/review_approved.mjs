// Paired prospective monitoring, independent from legacy shadow hypotheses.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {policyContext} from '../lib/approved-policy.mjs';
import {summarizeApproved} from '../site/approved-rules.mjs';
import {wilson} from '../lib/shadow-replay.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const state=resolve(opt('--state-dir','.dashboard-state/state')),data=resolve(opt('--data-dir','site/data')),now=Date.parse(opt('--now',new Date().toISOString()));
const config=JSON.parse(await readFile(new URL('../site/data/approved-rules.json',import.meta.url),'utf8'));
const registered=Date.parse(config.challenger.registered_at),records=[];
let days=[];try{days=(await readdir(join(state,'bars'))).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
for(const day of days)for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
 let archive;try{archive=JSON.parse(await readFile(join(state,'bars',day,symbol+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const open=Date.parse(archive.session.open),close=Date.parse(archive.session.close);
 if(open<=registered||close>now)continue;
 const today=archive.bars.filter(b=>Date.parse(b.time)>=open&&Date.parse(b.time)<close),expected=(close-open)/180000;
 if(today.length!==expected||today.some((b,i)=>Date.parse(b.time)!==open+i*180000)){records.push({symbol,day,status:'DATA_HOLD',reason:'Incomplete 3m session'});continue;}
 try{const x=policyContext(archive,archive.session,close+10000);records.push({symbol,day,status:'EVALUATED',source_fingerprint:archive.source.feed_fingerprint,runner:x.live.trades,no_runner:x.conservative.trades,radar:gradeRadar(x.rows,archive.bars,close)});}catch(e){records.push({symbol,day,status:'DATA_HOLD',reason:e.message});}
}
function gradeRadar(rows,bars,close){return rows.filter(r=>r.radar.highlight).map(r=>{
 const at=Date.parse(r.time),future=bars.filter(b=>Date.parse(b.time)>=at&&Date.parse(b.time)+180000<=at+3600000);
 const resolved=at+3600000<=close&&future.length===20&&future.every((b,i)=>Date.parse(b.time)===at+i*180000);
 return {time:r.time,score:r.radar.score,lean:r.radar.lean,resolved,hit:resolved?r.radar.lean*(future.at(-1).close-r.close)>0:null};
});}
const valid=records.filter(r=>r.status==='EVALUATED');
const eligible=valid.filter(r=>!r.runner.some(t=>t.time_exit_pending||t.status==='UNRESOLVED')&&!r.no_runner.some(t=>t.time_exit_pending||t.status==='UNRESOLVED'));
const runner=summarizeApproved(eligible.flatMap(r=>r.runner)),noRunner=summarizeApproved(eligible.flatMap(r=>r.no_runner));
const radar=valid.flatMap(r=>r.radar).filter(r=>r.resolved),hits=radar.filter(r=>r.hit).length;
const sessions=new Set(eligible.map(r=>r.day)).size;
const output={schema_version:1,version:config.version,updated_at:new Date(now).toISOString(),registration:config.challenger,session_count:sessions,ticker_sessions:valid.length,runner,no_runner:noRunner,radar:{event:'Lean agrees with close-to-close direction after exactly 20 confirmed 3m bars',hits,n:radar.length,rate:radar.length>=20?hits/radar.length:null,wilson_95:radar.length>=20?wilson(hits,radar.length):null,unresolved_n:valid.flatMap(r=>r.radar).filter(r=>!r.resolved).length},records:valid.map(r=>({symbol:r.symbol,day:r.day,runner:summarizeApproved(r.runner),no_runner:summarizeApproved(r.no_runner),radar_n:r.radar.filter(x=>x.resolved).length})),data_holds:records.filter(r=>r.status!=='EVALUATED'),promotion:{automatic:false,promoted:false,sample_floor_met:sessions>=30&&Math.min(runner.n,noRunner.n)>=100,reason:'Sample floor permits review only; human-reviewed PR and all registered gates still required'},note:'Both variants are measured from the same complete prospective sessions, never the supplied tuning week. Underlying model, no orders. One week is a small sample.'};
await mkdir(data,{recursive:true});await mkdir(join(state,'approved'),{recursive:true});await writeFile(join(data,'policy-evidence.json'),JSON.stringify(output)+'\n');await writeFile(join(state,'approved','review.json'),JSON.stringify({...output,raw_records:records})+'\n');console.log(JSON.stringify({prospective_sessions:sessions,runner_n:runner.n,no_runner_n:noRunner.n,radar_n:radar.length,promoted:false}));
