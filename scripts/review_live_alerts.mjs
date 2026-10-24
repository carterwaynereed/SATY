// Replay-only model evidence; not claimed to be delivered alerts or broker fills.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildLiveSnapshot} from '../lib/saty-live.mjs';
import {attachApproved} from '../lib/approved-policy.mjs';
import {bounceReferences,replayBounce} from '../lib/level-bounce.mjs';
import {replayAlertDesk} from '../lib/live-alerts.mjs';
import {outcomeStats} from '../site/outcome-stats.mjs';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d,state=resolve(opt('--state-dir','.dashboard-state/state')),now=Date.parse(opt('--now',new Date().toISOString()));
const calendar=JSON.parse(await readFile(new URL('../hosting/session-calendar.json',import.meta.url))),events=JSON.parse(await readFile(new URL('../hosting/bounce-events.json',import.meta.url))),config=JSON.parse(await readFile(new URL('../learning/live-alerts.json',import.meta.url)));
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
let days=[];try{days=(await readdir(join(state,'bars'))).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));}catch(e){if(e.code!=='ENOENT')throw e;}
const records=[],errors=[],dir=join(state,'live-alerts');await mkdir(join(dir,'sessions'),{recursive:true});
for(const day of days){if(day<config.forward_testing_from)continue;const context=await read(join(state,'pullback-vix/context',day+'.json'))??{},vix15=await read(join(dir,'context',day+'.json')),hours=await read(join(state,'level-bounce-v2/context',day+'.json')),symbols={};
 for(const symbol of ['SPY','SPX','AAPL','GOOGL']){const a=await read(join(state,'bars',day,symbol+'.json'));if(!a)continue;try{const s=attachApproved(a,buildLiveSnapshot(a,null,calendar,Math.min(now,Date.parse(a.session.close)+10000)),now);s.bounce_reference=bounceReferences(a,s,calendar);s.level_bounce=replayBounce(s,{reference:s.bounce_reference,overnight:context.overnight?.[symbol],vix:context.vix,events,calendar},{now});symbols[symbol]=s;}catch(e){errors.push({day,symbol,reason:e.message});}}
 const x=replayAlertDesk({symbols},context,{vix15,hours:hours?.series??{}},calendar,events,now),trades=x._reservations.map(t=>({...t,observation_kind:'REPLAY_ONLY'}));const record={day,definition:'Target hit before stop versus closed green after partial scale / time exit; PF from weighted modeled underlying return. Replay-only, no claimed delivered alert.',trades,budget:x.alert_budget};records.push(record);await writeFile(join(dir,'sessions',day+'.json'),JSON.stringify(record)+'\n');
}
const ts=records.flatMap(r=>r.trades),by_setup={};for(const id of ['MAIN','LEVEL_BOUNCE','ON_LOW','MORNING_HIGH','BOX_BREAK'])by_setup[id]=outcomeStats(ts.filter(t=>t.setup_id===id));
await writeFile(join(dir,'evidence.json'),JSON.stringify({schema_version:1,updated_at:new Date(now).toISOString(),sample:'REPLAY_ONLY',by_setup,errors})+'\n');console.log(JSON.stringify({sessions:records.length,errors_n:errors.length}));
