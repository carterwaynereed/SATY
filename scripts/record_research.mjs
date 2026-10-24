import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {decisionRows} from '../lib/research-ledger.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function load(p,fallback){try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function lines(p){try{return (await readFile(p,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function save(p,v){await writeFile(p,JSON.stringify(v)+'\n');}
export async function recordResearch(feeds,snapshots,state,now) {
  const dirs=['decisions','bars','captures','revisions'];await Promise.all(dirs.map(d=>mkdir(join(state,d),{recursive:true})));
  const summary={schema_version:1,generated_at:new Date(now).toISOString(),symbols:{},
    definition:'WAIT means no new managed baseline entry. OBSERVED and REPLAY_LATE are separate; neither is an executed fill.'};
  for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
    const snapshot=snapshots[symbol],feed=feeds[symbol],day=snapshot?.session?.date;
    const captured={symbol,observed_at:summary.generated_at,state:snapshot?.health?.state??'UNAVAILABLE',
      bar_time:snapshot?.health?.price_asof??null,one_minute_state:snapshot?.one_minute_health?.state??'UNAVAILABLE'};
    await appendFile(join(state,'captures',summary.generated_at.slice(0,10)+'.jsonl'),JSON.stringify(captured)+'\n');
    if(!feed||feed.error||!/^\d{4}-\d{2}-\d{2}$/.test(day)||snapshot?.health?.state==='UNAVAILABLE')continue;
    const rows=decisionRows(feed,snapshot.session,now),path=join(state,'decisions',day+'.jsonl');
    const prior=await lines(path),known=new Map(prior.map(x=>[x.id,x]));
    for(const r of rows){
      if(!known.has(r.id)){await appendFile(path,JSON.stringify(r)+'\n');known.set(r.id,r);}
      else {
        const old=known.get(r.id),fields=x=>[x.decision,x.close,x.evidence_score,x.row_directions];
        if(hash(fields(old))!==hash(fields(r))){
          const revision={id:r.id,observed_at:r.observed_at,type:'PROVIDER_REPLAY_REVISION',prior_hash:hash(fields(old)),new_hash:hash(fields(r))};
          const rp=join(state,'revisions',day+'.jsonl'),seen=await lines(rp);
          if(!seen.some(x=>x.id===revision.id&&x.new_hash===revision.new_hash))await appendFile(rp,JSON.stringify(revision)+'\n');
        }
      }
    }
    const dir=join(state,'bars',day);await mkdir(dir,{recursive:true});const archivePath=join(dir,symbol+'.json');
    const old=await load(archivePath,null);
    if(old&&old.source.feed_fingerprint!==feed.source.feed_fingerprint)throw Error('Feed changed within archived session: '+symbol+' '+day);
    const archive=old??{schema_version:1,symbol,session:snapshot.session,source:feed.source,first_received_at:summary.generated_at,
      daily:feed.daily,bars:[],one_bars:[],trend_bars:[],first_seen:{}};
    for(const name of ['bars','one_bars','trend_bars']){
      const mapping=new Map(archive[name].map(b=>[b.time,b]));
      for(const b of feed[name]??[]){if(!mapping.has(b.time)){mapping.set(b.time,b);if(name==='bars')archive.first_seen[b.time]=summary.generated_at;}}
      archive[name]=[...mapping.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    }
    archive.last_received_at=summary.generated_at;await save(archivePath,archive);
    const own=[...known.values()].filter(r=>r.symbol===symbol&&r.session_date===day&&r.source_fingerprint===feed.source.feed_fingerprint);
    summary.symbols[symbol]={session_date:day,n:own.length,wait_n:own.filter(r=>r.decision==='WAIT').length,
      observed_n:own.filter(r=>r.observation_kind==='OBSERVED').length,
      observed_wait_n:own.filter(r=>r.observation_kind==='OBSERVED'&&r.decision==='WAIT').length,
      late_replay_n:own.filter(r=>r.observation_kind==='REPLAY_LATE').length,
      archive:'state/decisions/'+day+'.jsonl'};
  }
  return summary;
}
