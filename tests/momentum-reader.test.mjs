import test from 'node:test';
import assert from 'node:assert/strict';
import {createMomentumReader,momentumPremarketReference,mergeMomentumEvidence,validMomentumEvidence,MOMENTUM_DAY_PREFIX,MOMENTUM_EVIDENCE_KEY,MOMENTUM_PREMARKET_KEY} from '../lib/momentum-reader.mjs';
import {MOMENTUM_VERSION} from '../lib/momentum.mjs';

const day='2026-10-26',open=Date.parse(day+'T13:30:00Z'),iso=t=>new Date(t).toISOString(),now=open+12*180000+10000;
const calendar={sessions:{[day]:{open:iso(open),close:iso(open+390*60000)}}};
const symbols=['SPY','SPX','AAPL','GOOGL'];
function bundle(at=now){const close=open+Math.floor((at-open)/180000)*180000;return {schema_version:2,symbols:Object.fromEntries(symbols.map(symbol=>[symbol,{session:{date:day},health:{state:'CURRENT',price_asof:iso(close),source:{source_id:'same-source'}},market:{symbol},signals:[{id:'legacy-reference'}],approved_rules:{position:{id:'legacy-live'}},level_bounce:{position:{id:'bounce-live'}}}])),alert_budget:{total:5},momentum_context:Object.fromEntries(symbols.map(s=>[s,{history:[],one_bars:[],source:{source_id:'same-source'}}]))};}
function candidate(symbol='SPY',at=now-10000){return {id:MOMENTUM_VERSION+'|'+symbol+'|'+day+'|'+at,version:MOMENTUM_VERSION,symbol,session_date:day,side:1,atr:10,defended_level:{label:'Call trigger',price:100},levels:[{label:'+23.6',price:100},{label:'+38.2',price:101.46}],decision_at:iso(at),entry_at:iso(at),entry:null,target_hit:false,state:'PENDING_ENTRY',status:'WAIT'};}
function fakeReplay(signal){return (inputs,cal,options)=>{let selected=options.reservation??(signal&&Date.parse(signal.entry_at)>=options.entryAfter?signal:null);if(selected&&inputs.SPY.snapshot?.test_closed)selected={...selected,state:'CLOSED',status:'EXIT',entry:100,target_hit:true,target_hit_at:iso(now),exit:103,exit_at:iso(now),return_pct:3,exit_reason:'Synthetic test close'};return {state:selected?'HOLD':'WAIT',signal:selected,_reservation:selected,second_signal:selected?candidate('AAPL'):null,candidates:signal?[signal]:[],rejected:[],holds:[]};};}
const summarize=rows=>({n:rows.filter(r=>r.target_hit||r.state==='CLOSED').length,wins:rows.filter(r=>r.target_hit).length,target_hit_rate:null,interval:null});
const noOvernight=async()=>{throw Error('No public extended bars');};
class Bucket{
 map=new Map();revision=0;reads=[];writes=[];
 async get(key){this.reads.push(key);const x=this.map.get(key);return x?{etag:String(x.etag),json:async()=>JSON.parse(x.value)}:null;}
 async put(key,value,options={}){this.writes.push(key);const old=this.map.get(key),test=options.onlyIf;if(test?.etagDoesNotMatch==='*'&&old||test?.etagMatches&&String(old?.etag)!==test.etagMatches)return null;const etag=++this.revision;this.map.set(key,{etag,value});return {etag:String(etag)};}
 record(key){return JSON.parse(this.map.get(key).value);}
}
const make=(signal,extra={})=>createMomentumReader(calendar,{clock:()=>now,overnightReader:noOvernight,replay:fakeReplay(signal),summarize,...extra});

test('durable admission consumes one global slot, strips raw history and legacy live fields',async()=>{
 const bucket=new Bucket(),signal=candidate(),read=make(signal),result=await read(bundle(),bucket);
 assert.equal(result.momentum.signal.id,signal.id);assert.equal(result.momentum.entries_today,1);assert.equal(result.momentum.signal.observation_kind,'ISSUED');
 assert.equal(bucket.record(MOMENTUM_DAY_PREFIX+day+'.json').reservation.id,signal.id);
 assert.equal(result.momentum_context,undefined);assert.equal(result.alert_budget,undefined);
 for(const s of Object.values(result.symbols)){assert.equal(s.approved_rules,undefined);assert.equal(s.level_bounce,undefined);assert.equal(s.signals[0].live,false);assert.equal(s.signals[0].research_only,true);}
 assert.equal(result.momentum.second_signal.live,false);assert.equal(result.momentum.second_signal.research_only,true);
 assert.equal(bucket.record(MOMENTUM_EVIDENCE_KEY).records[day].id,signal.id);assert.equal(result.momentum.stats.issued_n,1);
});

test('two independently initialized readers cannot race into two daily signals',async()=>{
 const bucket=new Bucket(),spy=candidate(),aapl=candidate('AAPL'),r1=make(spy),r2=make(aapl);
 const [a,b]=await Promise.all([r1(bundle(),bucket),r2(bundle(),bucket)]);
 const saved=bucket.record(MOMENTUM_DAY_PREFIX+day+'.json').reservation;
 assert.equal(a.momentum.signal.id,saved.id);assert.equal(b.momentum.signal.id,saved.id);
 assert.equal(Object.keys(bucket.record(MOMENTUM_EVIDENCE_KEY).records).length,1);
 assert.equal((await make(candidate('GOOGL'))(bundle(),bucket)).momentum.signal.id,saved.id);
});

test('missing storage or failed daily write withholds new instructions',async()=>{
 const missing=await make(candidate())(bundle(),null);assert.equal(missing.momentum.state,'DATA HOLD');assert.equal(missing.momentum.signal,null);assert.equal(missing.momentum.entries_today,0);
 const fail={get:async()=>null,put:async()=>{throw Error('unavailable');}};
 const result=await make(candidate())(bundle(),fail);assert.equal(result.momentum.signal,null);assert.equal(result.momentum.state,'DATA HOLD');assert.equal(result.momentum.stats.n,0);
});

test('old replay events, stale or unmatched ticker batches never become new alerts',async()=>{
 const bucket=new Bucket();assert.equal((await make(candidate('SPY',now-61000))(bundle(),bucket)).momentum.signal,null);
 for(const field of ['stale','mismatch','missing']){const b=bundle();if(field==='stale')b.symbols.AAPL.health.state='STALE';if(field==='mismatch')b.symbols.AAPL.health.price_asof=iso(now-30000);if(field==='missing')delete b.symbols.AAPL;
  const x=await make(candidate())(b,bucket);assert.equal(x.momentum.signal,null);assert.equal(x.momentum.state,'DATA HOLD');
 }
 assert.ok(!bucket.map.has(MOMENTUM_DAY_PREFIX+day+'.json'));
});

test('a saved signal remains identifiable through stale data and daily write failure',async()=>{
 const bucket=new Bucket(),signal=candidate(),read=make(signal);await read(bundle(),bucket);
 const stale=bundle();stale.symbols.SPY.health.state='STALE';const x=await read(stale,bucket);
 assert.equal(x.momentum.signal.id,signal.id);assert.equal(x.momentum.signal.read_only,true);assert.equal(x.momentum.signal.live,false);assert.equal(x.momentum.state,'DATA HOLD');
 const b=bundle();b.symbols.SPY.test_closed=true;const put=bucket.put.bind(bucket);bucket.put=async(key,...args)=>{if(key===MOMENTUM_DAY_PREFIX+day+'.json')throw Error('write failed');return put(key,...args);};
 const y=await read(b,bucket);assert.equal(y.momentum.signal.id,signal.id);assert.equal(y.momentum.entries_today,1);assert.equal(y.momentum.signal.read_only,true);assert.equal(y.momentum.storage_state,'DATA HOLD');
});

test('forward outcomes update idempotently and evidence failure does not invent empty stats',async()=>{
 const bucket=new Bucket(),read=make(candidate());await read(bundle(),bucket);const b=bundle();b.symbols.SPY.test_closed=true;
 const first=await read(b,bucket),second=await read(b,bucket);assert.equal(first.momentum.stats.n,1);assert.equal(first.momentum.stats.wins,1);assert.equal(second.momentum.stats.issued_n,1);
 const get=bucket.get.bind(bucket);bucket.get=async key=>{if(key===MOMENTUM_EVIDENCE_KEY)throw Error('Evidence unavailable');return get(key);};
 const held=await read(b,bucket);assert.equal(held.momentum.stats.state,'DATA HOLD');assert.equal(held.momentum.stats.n,1);assert.equal(held.momentum.stats.issued_n,1);
});

test('3 PM, weekends and pre-cutover observations do not allocate a new daily alert',async()=>{
 for(const at of [Date.parse(day+'T19:00:00Z'),Date.parse('2026-10-24T15:00:00Z')]){
  const bucket=new Bucket(),signal=candidate('SPY',at-1000),result=await make(signal,{clock:()=>at})(bundle(at),bucket);
  assert.equal(result.momentum.signal,null);assert.equal(result.momentum.entries_today,0);assert.ok(!bucket.map.has(MOMENTUM_DAY_PREFIX+result.momentum.session_date+'.json'));
 }
});

test('premarket reference freezes only complete current-day 04:00–09:30 bars',()=>{
 const bars=Array.from({length:330},(_,i)=>({time:iso(open-(330-i)*60000),open:100,high:101,low:99,close:100})),source={source_id:'same-source'},feed={bars:[{time:day+'T00:00:00Z',open:100,high:999,low:1,close:100},...bars],source};
 const ref=momentumPremarketReference(feed,day,calendar,source);assert.equal(ref.low,99);assert.equal(ref.high,101);assert.equal(ref.bar_count,330);assert.equal(ref.asof,iso(open));
 assert.equal(momentumPremarketReference({...feed,bars:bars.slice(1)},day,calendar,source),null);
 assert.equal(momentumPremarketReference(feed,day,calendar,{source_id:'different'}),null);
 assert.equal(momentumPremarketReference({...feed,source:{...source,reported_delay:60}},day,calendar,source),null);
});

test('frozen premarket reads are cached and never fetch SPX or closed sessions',async()=>{
 const bucket=new Bucket(),calls=[],source={source_id:'same-source'},bars=Array.from({length:330},(_,i)=>({time:iso(open-(330-i)*60000),open:100,high:101,low:99,close:100}));
 const read=make(null,{overnightReader:async symbol=>{calls.push(symbol);return {bars,source};}});await read(bundle(),bucket);await read(bundle(),bucket);
 assert.deepEqual(calls.sort(),['AAPL','GOOGL','SPY']);assert.equal(bucket.record(MOMENTUM_PREMARKET_KEY).values.SPY.low,99);
 const closed=make(null,{clock:()=>Date.parse(day+'T21:00:00Z'),overnightReader:async()=>{throw Error('Must not poll after close');}});assert.equal((await closed(bundle(),bucket)).momentum.state,'CLOSED');
});

test('an already observed entry or finished move is never newly labeled issued',async()=>{
 for(const state of ['TRACKING','CLOSED']){
  const signal={...candidate(),state,status:state==='CLOSED'?'EXIT':'HOLD',entry:100,target_hit:state==='CLOSED',...(state==='CLOSED'?{exit:103,exit_at:iso(now),return_pct:3}:{})};
  const bucket=new Bucket(),result=await make(signal)(bundle(),bucket);
  assert.equal(result.momentum.signal,null);assert.equal(result.momentum.entries_today,0);assert.ok(!bucket.map.has(MOMENTUM_DAY_PREFIX+day+'.json'));
 }
});

test('slow auxiliary reads cannot backdate the first observation into the admission window',async()=>{
 let at=now;const bucket=new Bucket(),read=make(candidate(),{clock:()=>at,overnightReader:async()=>{at=now+60000;throw Error('slow unavailable feed');}});
 const result=await read(bundle(),bucket);assert.equal(result.momentum.signal,null);assert.equal(result.momentum.entries_today,0);
});

test('invalid persisted reservations hold the desk rather than resetting the daily budget',async()=>{
 const bucket=new Bucket(),bad={...candidate(),atr:null};await bucket.put(MOMENTUM_DAY_PREFIX+day+'.json',JSON.stringify({version:MOMENTUM_VERSION,day,reservation:bad}));
 const result=await make(candidate('AAPL'))(bundle(),bucket);assert.equal(result.momentum.state,'DATA HOLD');assert.equal(result.momentum.signal,null);assert.equal(bucket.record(MOMENTUM_DAY_PREFIX+day+'.json').reservation.atr,null);
});

test('evidence merges cannot erase an established win or terminal observation',()=>{
 const pending={...candidate(),last_price_at:iso(now-180000)},won={...pending,entry:100,state:'TRACKING',status:'HOLD',target_hit:true,target_hit_at:iso(now-60000),last_price_at:iso(now-60000)},closed={...won,state:'CLOSED',status:'EXIT',exit:101,exit_at:iso(now),return_pct:1};
 assert.equal(mergeMomentumEvidence(won,pending).target_hit,true);
 const saved=mergeMomentumEvidence(closed,{...pending,last_price_at:iso(now+60000)});assert.equal(saved.state,'CLOSED');assert.equal(saved.target_hit,true);assert.equal(saved.exit,101);
 assert.equal(mergeMomentumEvidence(closed,candidate('AAPL')).id,closed.id);
});

test('stale-date cached premarket references are rejected even when the source matches',async()=>{
 const bucket=new Bucket(),wrong={day:'2026-10-23',session_date:'2026-10-23',complete:true,bar_count:330,source:{source_id:'same-source'},asof:iso(open),low:99,high:101};
 await bucket.put(MOMENTUM_PREMARKET_KEY,JSON.stringify({day,values:{SPY:wrong},attempts:{}}));
 let captured;const read=make(null,{replay:(inputs)=>{captured=inputs.SPY.overnight;return {signal:null,_reservation:null};}});await read(bundle(),bucket);assert.equal(captured,null);
});

test('a later visit resolves a previously issued time exit from retained bars without adding an alert',async()=>{
 const nextDay='2026-10-27',nextNow=Date.parse(nextDay+'T14:00:10Z'),nextOpen=Date.parse(nextDay+'T13:30:00Z'),cal={sessions:{...calendar.sessions,[nextDay]:{open:iso(nextOpen),close:nextDay+'T20:00:00Z'}}};
 const saved={...candidate(),entry:100,state:'TRACKING',status:'HOLD',first_observed_at:iso(now),observation_kind:'ISSUED'};
 const bucket=new Bucket();await bucket.put(MOMENTUM_DAY_PREFIX+day+'.json',JSON.stringify({schema_version:1,version:MOMENTUM_VERSION,day,reservation:saved}));
 const b=bundle();for(const s of Object.values(b.symbols)){s.session={date:nextDay,open:iso(nextOpen),close:nextDay+'T20:00:00Z'};s.health.price_asof=nextDay+'T14:00:00Z';}
 b.momentum_context.SPY.history=Array.from({length:130},(_,i)=>({time:iso(open+i*180000),open:100,high:100.5,low:99.5,close:100.2}));
 b.momentum_context.SPY.one_bars=[{time:day+'T19:54:00Z',open:100.2,high:100.6,low:100,close:100.5}];
 const read=createMomentumReader(cal,{clock:()=>nextNow,overnightReader:noOvernight,replay:fakeReplay(null)}),result=await read(b,bucket);
 assert.equal(result.momentum.signal,null);assert.equal(result.momentum.entries_today,0);assert.equal(result.momentum.stats.issued_n,1);assert.equal(result.momentum.stats.n,1);assert.equal(result.momentum.stats.wins,0);
 const finished=bucket.record(MOMENTUM_DAY_PREFIX+day+'.json').reservation;assert.equal(finished.state,'CLOSED');assert.equal(finished.exit_at,day+'T19:55:00.000Z');
});

test('individual evidence rows reject malformed states, prices, outcomes, provenance and injected rates',async()=>{
 const bucket=new Bucket(),read=make(candidate());await read(bundle(),bucket);const closed=bundle();closed.symbols.SPY.test_closed=true;await read(closed,bucket);
 const valid=bucket.record(MOMENTUM_EVIDENCE_KEY).records[day];assert.equal(validMomentumEvidence(valid,day,calendar,now),true);
 const invalid=[
  {...valid,state:'INVENTED'}, {...valid,status:'HOLD'}, {...valid,entry:'100'}, {...valid,entry:null}, {...valid,entry:-1},
  {...valid,exit:null}, {...valid,exit:0}, {...valid,return_pct:90}, {...valid,return_pct:Infinity},
  {...valid,target_hit:'yes'}, {...valid,target_hit:true,target_hit_at:null}, {...valid,target_hit:false},
  {...valid,target_hit_at:iso(now+60000)}, {...valid,target_hit_at:iso(Date.parse(valid.entry_at)-1000)},
  {...valid,exit_at:iso(Date.parse(valid.entry_at)-1000)}, {...valid,first_observed_at:iso(now+61000)},
  {...valid,side:0}, {...valid,direction:'PUT'}, {...valid,session_date:'2026-10-23'},
  {...valid,observation_kind:'REPLAY_ONLY'}, {...valid,win_rate:1}, {...valid,profit_factor:99},
  {...valid,state:'PENDING_ENTRY',status:'WAIT'}, {...valid,exit_reason:null}
 ];
 for(const record of invalid)assert.equal(validMomentumEvidence(record,day,calendar,now),false,JSON.stringify(record));
});

test('a malformed saved evidence row withholds all forward statistics without overwriting the record',async()=>{
 const bucket=new Bucket();await make(candidate())(bundle(),bucket);const saved=bucket.record(MOMENTUM_EVIDENCE_KEY),record=saved.records[day];
 const malformed={...saved,records:{[day]:{...record,state:'CLOSED',status:'EXIT',target_hit:true,entry:null,win_rate:1}}};
 await bucket.put(MOMENTUM_EVIDENCE_KEY,JSON.stringify(malformed));
 const x=await make(null)(bundle(),bucket);assert.equal(x.momentum.stats.state,'DATA HOLD');assert.equal(x.momentum.stats.n,null);assert.equal(x.momentum.stats.target_hit_rate,null);assert.deepEqual(bucket.record(MOMENTUM_EVIDENCE_KEY),malformed);
});
