import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {evaluateCandidate,ruleHash,summarizeEpisodes,promotionStatus} from '../lib/shadow-replay.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const state=resolve(opt('--state-dir','.dashboard-state/state')),data=resolve(opt('--data-dir','site/data'));
const now=opt('--now',new Date().toISOString());
async function load(p,fallback){try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
let registry=[];try{registry=(await readFile(join(data,'challengers.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
const latest=new Map(registry.map(c=>[c.candidate_id,c]));
const candidates=[...latest.values()].filter(c=>c.status==='SHADOW'&&c.rule_set);
// Existing governance allows one designated challenger, not an untracked search.
if(candidates.length>1)throw Error('Only one active shadow challenger is permitted');
await mkdir(join(state,'shadow'),{recursive:true});await mkdir(data,{recursive:true});
let days=[];try{days=(await readdir(join(state,'bars'))).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
const summary={schema_version:1,evidence_state:'SHADOW_REPLAY_UNVALIDATED',updated_at:now,candidates:[],errors:[]};
for(const candidate of candidates){
  if(!/^[A-Za-z0-9_-]+$/.test(candidate.candidate_id))throw Error('Unsafe candidate ID');
  const folder=join(state,'shadow',candidate.candidate_id);await mkdir(folder,{recursive:true});
  let expectedHash;try{expectedHash=ruleHash(candidate.rule_set);}catch(e){summary.errors.push({candidate_id:candidate.candidate_id,error:e.message});continue;}
  for(const day of days){
    const archive=await load(join(state,'bars',day,candidate.symbol+'.json'),null);if(!archive)continue;
    if(Date.parse(now)<Date.parse(archive.session.close))continue;
    const path=join(folder,day+'.json'),old=await load(path,null);
    if(old){if(old.rule_hash!==expectedHash)throw Error('A registered shadow rule was changed without a new candidate ID');continue;}
    const result=evaluateCandidate(candidate,archive);
    if(result.status==='EVALUATED')await writeFile(path,JSON.stringify(result)+'\n');
    else summary.errors.push({candidate_id:candidate.candidate_id,session_date:day,...result});
  }
  const records=await Promise.all((await readdir(folder)).filter(n=>n.endsWith('.json')).map(n=>load(join(folder,n),null)));
  const shadow=records.flatMap(r=>r.shadow.episodes),baseline=records.flatMap(r=>r.baseline.episodes);
  const stats=summarizeEpisodes(shadow),sessionN=records.length;
  summary.candidates.push({candidate_id:candidate.candidate_id,symbol:candidate.symbol,rule_set:candidate.rule_set,rule_hash:expectedHash,
    registered_at:candidate.registered_at,sessions:sessionN,episodes_n:stats.n,shadow_only:true,
    baseline:summarizeEpisodes(baseline),challenger:stats,
    paired_sessions:records.map(r=>({session_date:r.session_date,delta_r:r.paired_session_r})),
    mean_paired_session_r:sessionN?records.reduce((s,r)=>s+r.paired_session_r,0)/sessionN:null,
    promotion:promotionStatus(sessionN,stats.n),archive:'state/shadow/'+candidate.candidate_id+'/'});
}
await writeFile(join(data,'shadow-evidence.json'),JSON.stringify(summary)+'\n');
console.log(JSON.stringify({shadow_candidates_n:summary.candidates.length,errors_n:summary.errors.length,live_rules_changed:false}));
