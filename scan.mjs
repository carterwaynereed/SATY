import {readFile,writeFile,mkdir,rename,rmdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {analyze,normalizeBars,paperOutcome,sessionAt,SYMBOLS,VERSION,journalStats,eastern} from './site/engine.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
export const dataDir=path.join(root,'data');
export async function readJSON(name,fallback){try{return JSON.parse(await readFile(path.join(dataDir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function saveJSON(name,value){await mkdir(dataDir,{recursive:true});const file=path.join(dataDir,name),tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2));await rename(tmp,file);}
export async function withDataLock(fn){await mkdir(dataDir,{recursive:true});const lock=path.join(dataDir,'.journal-lock');try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw new Error('Journal busy; retry after the current scan finishes');throw e;}try{return await fn();}finally{await rmdir(lock);}}
export async function snapshot(now=Date.now()){
 const feeds=await readJSON('feeds.json',{symbols:{}}),context=await readJSON('context.json',{}),journal=await readJSON('journal.json',[]),date=eastern(now).date;
 const closed=journal.filter(t=>t.status==='closed'&&eastern(t.exitedAt).date===date).sort((a,b)=>Date.parse(a.exitedAt)-Date.parse(b.exitedAt));
 let losses=0;for(let i=closed.length-1;i>=0&&closed[i].r<0;i--)losses++;
 const ctx={...context,activeSymbols:['SPY'],realizedR:closed.reduce((s,t)=>s+t.r,0),consecutiveLosses:losses};
 const analyses=SYMBOLS.map(symbol=>analyze({...feeds.symbols[symbol],symbol},now,ctx));
 return {version:VERSION,generatedAt:new Date(now).toISOString(),mode:'local',paperEntryMode:'local',feeds,context:ctx,journal,analyses,stats:journalStats(journal)};
}
export async function scan(now=Date.now(),autoPaper=true){return withDataLock(()=>scanUnlocked(now,autoPaper));}
async function scanUnlocked(now,autoPaper){
 let state=await snapshot(now),journal=state.journal;
 journal=journal.map(t=>{const feed=state.feeds.symbols[t.symbol]??{},observed=Date.parse(feed.fetchedAt);return ['pending','open'].includes(t.status)?paperOutcome(t,normalizeBars(feed.bars,t.symbol,Number.isFinite(observed)?Math.min(+now,observed):now).bars.filter(b=>b.market==='r')):t;});
 await saveJSON('journal.json',journal);
 state=await snapshot(now);
 if(autoPaper){for(const a of state.analyses){if(a.decision==='WAIT')continue;if(journal.some(t=>['pending','open','unresolved'].includes(t.status)))break;
  const dayTrades=journal.filter(t=>eastern(t.createdAt).date===eastern(now).date&&t.status!=='cancelled');if(dayTrades.length>=5)break;
  if(journal.some(t=>t.symbol===a.symbol&&Date.parse(t.createdAt)>+now-10*60000))continue;
  journal.push(makeTrade(a,now));break;
 }}
 await saveJSON('journal.json',journal);
 const final=await snapshot(now);await saveJSON('latest-analysis.json',{generatedAt:final.generatedAt,analyses:final.analyses,stats:final.stats});
 const {appendFile}=await import('node:fs/promises');
 await appendFile(path.join(dataDir,'scan-history.jsonl'),JSON.stringify({at:final.generatedAt,autoPaper,signals:final.analyses.map(a=>({symbol:a.symbol,decision:a.decision,asOf:a.asOf,gates:a.gates,setup:a.plan?.setup??null})),stats:final.stats})+'\n');
 return final;
}
export function makeTrade(a,now){if(a.decision==='WAIT'||!a.plan?.target)throw new Error('No eligible paper setup');return {id:`${a.symbol}-${a.asOf}`,symbol:a.symbol,...a.plan,signalEnd:new Date(Math.ceil(+now/60000)*60000).toISOString(),createdAt:new Date(now).toISOString(),status:'pending',strategyVersion:VERSION,session:a.session.name,score:a.scores,kind:'underlying-direction-study'};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const state=await scan(Date.now(),!process.argv.includes('--no-auto-paper'));console.log(JSON.stringify({at:state.generatedAt,session:sessionAt(Date.now()).name,signals:state.analyses.map(a=>({symbol:a.symbol,decision:a.decision,scores:a.scores,asOf:a.asOf,gates:a.gates,plan:a.plan})),stats:state.stats},null,2));
}
