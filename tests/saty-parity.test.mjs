// The reference outputs are from the unchanged Python sig2 engine, not the JS port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {replaySaty, barrierOutcomes, etParts} from '../lib/saty-live.mjs';
const root = new URL('../',import.meta.url);
const read = p => JSON.parse(p.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(new URL(p,root))):fs.readFileSync(new URL(p,root),'utf8'));

const fixtures=read('tests/fixtures/tv-replay-parity.json.gz');
const nearly=(a,b,label)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8,`${label}: got ${a}, Python ${b}`);
const stamp=t=>new Date(t).toISOString();
function bars(values, now=null){return Object.entries(values).map(([t,v])=>({time:new Date(Number(t)*1000).toISOString(),open:v[0],high:v[1],low:v[2],close:v[3],volume:v[4]??0})).filter(b=>now===null||Date.parse(b.time)+180000<=Date.parse(now)).sort((a,b)=>a.time.localeCompare(b.time));}
for(const [symbol,ref] of Object.entries(fixtures.by_symbol))test(`${symbol}: JS matches frozen Python rules, ATR, phase and outcomes across 34 sessions plus captured live day`,()=>{
 const archive=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`stats/tv/${symbol}/history.json.gz`,root))));
 assert.equal(archive.captured_at,ref.captured_at,'Python reference and captured history must share an input snapshot');
 const ledger=read(`stats/tv/${symbol}/ledger.json.gz`).ledger;
 const daily=bars(archive.daily),history=bars(archive.bars3,ref.captured_at).filter(b=>{const hm=etParts(b.time).hm;return hm>='09:30'&&hm<'16:00';});
 const dated=history.map(b=>({...b,day:etParts(b.time).day}));
 for(const c of ref.cases){
  const all=[...dated.filter(b=>b.day<c.day).slice(-400),...dated.filter(b=>b.day===c.day)];
  const actual=replaySaty(all,daily,c.day);nearly(actual.pc,c.pc,`${symbol} ${c.day} prev close`);nearly(actual.atr,c.atr,`${symbol} ${c.day} ATR`);
  for(const [key,value] of Object.entries(c.last_indicators))nearly(actual.indicators.at(-1)[key],value,`${symbol} ${c.day} ${key}`);
  assert.equal(actual.strategy.squeeze(),c.squeeze,`${symbol} ${c.day} squeeze`);
  const entries=actual.events.filter(e=>e.kind==='ENTRY');
  const expected=c.day===ref.current_day?ref.current_entries:ledger.filter(e=>e.session_date===c.day);
  assert.equal(entries.length,expected.length,`${symbol} ${c.day} entry count`);
  for(let i=0;i<entries.length;i++){
   const a=entries[i],e=expected[i],prefix=`${symbol} ${c.day} episode ${i}`;
   for(const key of ['setup','cohort'])assert.equal(a[key],e[key],`${prefix} ${key}`);
   assert.equal(a.side,typeof e.side==='number'?e.side:e.side==='LONG'?1:-1,`${prefix} side`);
   assert.equal(stamp(a.decision_time),stamp(e.decision_time??e.decision_at),`${prefix} decision`);
   nearly(a.stop,e.stop??e.original_stop,`${prefix} stop`);nearly(a.signal_close,e.signal_close,`${prefix} signal close`);
   assert.equal(a.targets.length,e.targets.length,`${prefix} target count`);
   for(let j=0;j<a.targets.length;j++){assert.equal(a.targets[j][0],e.targets[j][0],`${prefix} target${j+1} label`);nearly(a.targets[j][1],e.targets[j][1],`${prefix} target${j+1}`);}
   const after=actual.today.slice(a.i+1),entry=after[0]?.open??null;
   if(entry===null){assert.equal(e.status,'pending_entry',`${prefix} pending`);continue;}
   nearly(entry,e.entry,`${prefix} next-open entry`);
   const cancelled=!a.targets.length||a.side*(entry-a.stop)<=0||a.side*(a.targets[0][1]-entry)<=0;
   assert.equal(cancelled,e.status==='cancelled_gap',`${prefix} gap cancellation`);
   if(cancelled)continue;
   const output=barrierOutcomes(after,a.side,entry,a.stop,a.targets,c.complete);
   assert.deepEqual(output.result.map(r=>r.outcome),e.outcomes,`${prefix} original barrier outcomes`);
   assert.deepEqual(output.result.map(r=>r.ambiguous),e.amb??e.ambiguous,`${prefix} ambiguity`);
  }
 }
});
