import test from 'node:test';
import assert from 'node:assert/strict';
import {MOMENTUM_VERSION,sameTimeRvol,momentumCandidates,manageMomentum,momentumStats,replayMomentum,validMomentumReservation} from '../lib/momentum.mjs';

const T=Date.parse,iso=t=>new Date(t).toISOString();
const DAY='2026-10-23',OPEN=T(DAY+'T13:30:00Z'),CLOSE=T(DAY+'T20:00:00Z');
const candle=(at,open=100,close=open,low=Math.min(open,close)-.02,high=Math.max(open,close)+.02,volume=100)=>({time:iso(at),open,high,low,close,volume});
function fixture(symbol='SPY',today=null){
 const calendar={sessions:{}},history=[];let cursor=OPEN-86400000,days=[];
 while(days.length<20){const d=new Date(cursor).getUTCDay();if(d!==0&&d!==6)days.push(cursor);cursor-=86400000;}
 for(const open of days.reverse()){const day=iso(open).slice(0,10);calendar.sessions[day]={open:iso(open),close:iso(open+390*60000)};for(let i=0;i<130;i++)history.push(candle(open+i*180000));}
 calendar.sessions[DAY]={open:iso(OPEN),close:iso(CLOSE)};
 const bars=today??[
  candle(OPEN,100,100.3,99.99,100.31),
  candle(OPEN+180000,100.3,100.4,100.29,100.41),
  candle(OPEN+360000,100.4,100.55,100.38,100.57)
 ];
 const levels=[{label:'-38.2',price:99.618},{label:'-23.6',price:99.764},{label:'0',price:100},{label:'+23.6',price:100.236},{label:'+38.2',price:100.382},{label:'+50',price:100.5},{label:'+61.8',price:100.618},{label:'+100',price:101}];
 const snapshot={market:{symbol,atr14:1,prior_close:100},session:{date:DAY,...calendar.sessions[DAY]},bars,levels,one_minute_bars:[],health:{state:'CURRENT'}};
 return {calendar,input:{snapshot,history:[...history,...bars],overnight:null},history};
}
function candidate(input,overrides={}){
 return {id:'test-signal',version:MOMENTUM_VERSION,symbol:input.snapshot.market.symbol,session_date:DAY,side:1,direction:'CALL',setup_id:'TRIGGER_ESCAPE',setup:'Trigger escape',decision_at:iso(OPEN+180000),entry_at:iso(OPEN+180000),atr:1,defended_level:{label:'Call trigger +23.6',price:100.236},levels:input.snapshot.levels,...overrides};
}

test('RVOL uses the exact same slot in 20 completed prior sessions, median and no current-session lookahead',()=>{
 const {calendar,input}=fixture(),bar=input.snapshot.bars[0];
 const history=input.history.map(b=>({...b,volume:T(b.time)<OPEN?(T(b.time)===T(input.history[0].time)?10000:100):150}));
 const out=sameTimeRvol(history,bar,calendar);
 assert.equal(out.n,20);assert.equal(out.baseline_volume,100);assert.equal(out.value,1.5);
 const future=history.concat(candle(OPEN+86400000,100,100,99,101,999999));
 assert.deepEqual(sameTimeRvol(future,bar,calendar),out);
});

test('RVOL fails closed for incomplete history, zero baseline and missing volume',()=>{
 const {calendar,input}=fixture(),bar=input.snapshot.bars[0];
 assert.equal(sameTimeRvol(input.history.slice(1),bar,calendar).n,19);
 assert.equal(sameTimeRvol(input.history.slice(1),bar,calendar).value,null);
 assert.equal(sameTimeRvol(input.history.map(b=>({...b,volume:0})),bar,calendar).state,'DATA HOLD');
 assert.equal(sameTimeRvol(input.history.map(b=>T(b.time)===OPEN?{...b,volume:null}:b),bar,calendar).value,null);
});

test('RVOL excludes calendar-shortened days without the slot but never replaces eligible missing data',()=>{
 const {calendar,input}=fixture(),event=candle(OPEN+300*60000,100,100,99.99,100.01,120);
 const previous=Object.keys(calendar.sessions).filter(d=>d<DAY).sort();
 let extraOpen=T(calendar.sessions[previous[0]].open)-86400000;
 while([0,6].includes(new Date(extraOpen).getUTCDay()))extraOpen-=86400000;
 calendar.sessions[iso(extraOpen).slice(0,10)]={open:iso(extraOpen),close:iso(extraOpen+390*60000)};
 const extra=Array.from({length:130},(_,i)=>candle(extraOpen+i*180000));
 const early=calendar.sessions[previous.at(-1)],earlyOpen=T(early.open);
 early.close=iso(earlyOpen+210*60000);
 const history=[...extra,...input.history.filter(b=>T(b.time)<T(early.close)||T(b.time)>=OPEN),event];
 let out=sameTimeRvol(history,event,calendar);
 assert.equal(out.n,20);assert.equal(out.value,1.2);
 const missing=history.filter(b=>T(b.time)!==T(calendar.sessions[previous.at(-2)].open)+300*60000);
 out=sameTimeRvol(missing,event,calendar);
 assert.equal(out.n,19);assert.equal(out.state,'DATA HOLD');
});

test('exact RVOL 1.5 is skipped; low RVOL allows the confirmed escape without trend/VIX alignment',()=>{
 const {calendar,input}=fixture();
 input.history=input.history.map(b=>T(b.time)===OPEN?{...b,volume:150}:b);
 let out=momentumCandidates(input,calendar,{now:OPEN+540000});
 assert.equal(out.candidates.length,0);assert.match(out.rejected[0].reason,/1\.5 or higher/);
 input.history=input.history.map(b=>T(b.time)===OPEN?{...b,volume:149}:b);
 out=momentumCandidates(input,calendar,{now:OPEN+540000});
 assert.equal(out.candidates[0].setup_id,'TRIGGER_ESCAPE');assert.equal(out.candidates[0].rvol.value,1.49);
});

test('confirmed next-open entry does not use the event close or an unconfirmed price',()=>{
 const {input}=fixture(),c=candidate(input);
 assert.equal(manageMomentum(c,input,{now:OPEN+180000}).entry,null);
 let p=manageMomentum(c,input,{now:OPEN+360000});
 assert.equal(p.entry,100.3);assert.equal(p.target.price,100.536);assert.equal(p.stop,100);
 input.one_bars=[candle(OPEN+180000,100.32,100.34,100.31,100.35)];
 p=manageMomentum(c,input,{now:OPEN+240000});
 assert.equal(p.entry,100.32);assert.equal(p.target.price,100.556);assert.equal(p.state,'TRACKING');
});

test('a target hit is latched and remains HOLD while tracking later ladder levels',()=>{
 const {input}=fixture(),p=manageMomentum(candidate(input),input,{now:OPEN+540000});
 assert.equal(p.target_hit,true);assert.equal(p.state,'TRACKING');assert.equal(p.status,'HOLD');
 assert.equal(p.levels_covered,2);assert.deepEqual(p.level_hits.map(l=>l.label),['+38.2','+50']);
 assert.equal(p.next_level.label,'+61.8');assert.ok(Math.abs(p.mfe_atr-.27)<1e-10);
});

test('intrabar adverse/target ambiguity is stop-first and cannot create a win',()=>{
 const {input}=fixture();input.snapshot.bars=[input.snapshot.bars[0],candle(OPEN+180000,100.3,100.4,99.95,100.8)];
 const p=manageMomentum(candidate(input),input,{now:OPEN+360000});
 assert.equal(p.status,'EXIT');assert.equal(p.target_hit,false);assert.equal(p.ambiguous,true);assert.equal(p.exit,100);
});

test('confirmed minutes resolve target-first ordering before a later adverse stop',()=>{
 const {input}=fixture();input.snapshot.bars=[input.snapshot.bars[0],candle(OPEN+180000,100.3,100.1,99.95,100.8)];
 input.one_bars=[candle(OPEN+180000,100.3,100.55,100.29,100.6),candle(OPEN+240000,100.55,100.2,100.18,100.57),candle(OPEN+300000,100.2,100.1,99.95,100.22)];
 const p=manageMomentum(candidate(input),input,{now:OPEN+360000});
 assert.equal(p.status,'EXIT');assert.equal(p.target_hit,true);assert.equal(p.ambiguous,undefined);assert.equal(p.exit,100);
});

test('structural stop requires a confirmed 3m close past the level plus 0.1 ATR',()=>{
 const {input}=fixture();input.snapshot.bars=[input.snapshot.bars[0],candle(OPEN+180000,100.3,100.12,100.1,100.35)];
 const p=manageMomentum(candidate(input),input,{now:OPEN+360000});
 assert.equal(p.status,'EXIT');assert.match(p.reason,/confirmed close/);assert.equal(p.exit,100.12);
 input.one_bars=[candle(OPEN+180000,100.3,100.12,100.1,100.32)];
 const waiting=manageMomentum(candidate(input),input,{now:OPEN+240000});
 assert.equal(waiting.state,'TRACKING');assert.equal(waiting.status,'GET READY TO EXIT');
});

test('PUT management mirrors CALL entry, milestone, stops and level counting',()=>{
 const {input}=fixture('SPY',[candle(OPEN,100,99.7,99.68,100.02),candle(OPEN+180000,99.7,99.42,99.4,99.72)]);
 const p=manageMomentum(candidate(input,{side:-1,direction:'PUT',defended_level:{label:'Put trigger',price:99.764}}),input,{now:OPEN+360000});
 assert.equal(p.target.price,99.464);assert.equal(p.stop,100);assert.equal(p.target_hit,true);assert.equal(p.status,'HOLD');assert.equal(p.levels_covered,1);
});

test('pre-market and trigger retests are allowed after a distinct departure',()=>{
 const bars=[candle(OPEN,100,100.3,99.99,100.31),candle(OPEN+180000,100.3,100.4,100.3,100.42),candle(OPEN+360000,100.4,100.3,100.24,100.42)];
 const {calendar,input}=fixture('SPY',bars);input.overnight={low:99.99,high:101,session_date:DAY,asof:iso(OPEN),complete:true};
 const out=momentumCandidates(input,calendar,{now:OPEN+540000});
 assert.ok(out.candidates.some(c=>c.setup_id==='PM_LOW_HOLD'));assert.ok(out.candidates.some(c=>c.setup_id==='TRIGGER_RETEST'));
 input.overnight={...input.overnight,asof:iso(OPEN+1000)};
 assert.equal(momentumCandidates(input,calendar,{now:OPEN+540000}).candidates.some(c=>c.setup_id==='PM_LOW_HOLD'),false);
});

test('one globally selected signal is causal, deterministic, and sticky against late history',()=>{
 const a=fixture('AAPL'),s=fixture('SPY');const inputs={AAPL:a.input,SPY:s.input};
 const first=replayMomentum(inputs,s.calendar,{now:OPEN+540000});
 assert.equal(first.signal.symbol,'SPY');assert.equal(first.max_signals_per_day,1);assert.equal(first.second_signal.watch_only,true);
 assert.equal(first.second_signal.symbol,'AAPL');
 const reservation={...first.signal,symbol:'AAPL',id:'already-issued-AAPL'};
 const sticky=replayMomentum(inputs,s.calendar,{now:OPEN+540000,reservation,entryAfter:Infinity});
 assert.equal(sticky.signal.id,'already-issued-AAPL');assert.equal(sticky._reservation.entry,first.signal.entry);
 assert.equal(replayMomentum(inputs,s.calendar,{now:OPEN+540000,entryAfter:OPEN+180001}).signal,null);
});

test('SPX uses the SPY same-time volume proxy and never a made-up native volume',()=>{
 const x=fixture('SPX'),s=fixture('SPY');
 x.input.history=x.input.history.map(b=>({...b,volume:null}));
 const output=replayMomentum({SPX:x.input,SPY:{...s.input,snapshot:{...s.input.snapshot,bars:[]}}},x.calendar,{now:OPEN+540000});
 assert.equal(output.signal.symbol,'SPX');assert.equal(output.signal.rvol.proxy_symbol,'SPY');assert.equal(output.signal.rvol.value,1);
 assert.equal(replayMomentum({SPX:x.input},x.calendar,{now:OPEN+540000}).signal,null);
});

test('no activation at 15:00 and missing session bars do not produce later events',()=>{
 const bars=Array.from({length:111},(_,i)=>candle(OPEN+i*180000,100,i===109?100.3:100));
 const {calendar,input}=fixture('SPY',bars);
 assert.equal(momentumCandidates(input,calendar,{now:OPEN+111*180000}).candidates.length,0);
 input.snapshot.bars=[candle(OPEN),candle(OPEN+360000,100,100.3)];
 const result=momentumCandidates(input,calendar,{now:OPEN+540000});
 assert.equal(result.candidates.length,0);assert.ok(result.holds.some(x=>x.includes('Missing regular-session')));
});

test('15:55 uses the exact confirmed minute; missing time-exit evidence remains unresolved',()=>{
 const bars=Array.from({length:129},(_,i)=>candle(OPEN+i*180000,100.3,100.3,100.29,100.31));
 const {input}=fixture('SPY',bars);
 const c=candidate(input);input.one_bars=[candle(CLOSE-6*60000,100.3,100.35,100.29,100.36)];
 let p=manageMomentum(c,input,{now:CLOSE-5*60000});
 assert.equal(p.status,'EXIT');assert.equal(p.exit_at,iso(CLOSE-5*60000));assert.equal(p.exit,100.35);assert.equal(p.target_hit,false);
 input.one_bars=[];p=manageMomentum(c,input,{now:CLOSE});assert.equal(p.state,'UNRESOLVED');assert.equal(p.target_hit,false);
});

test('persisted wins and closed outcomes survive missing or revised later history',()=>{
 const {input}=fixture(),won=manageMomentum(candidate(input),input,{now:OPEN+540000});
 input.snapshot.bars=[];
 const retained=manageMomentum(won,input,{now:CLOSE});
 assert.equal(retained.target_hit,true);assert.equal(retained.target_hit_at,won.target_hit_at);assert.equal(retained.state,'UNRESOLVED');
 const closed={...won,state:'CLOSED',status:'EXIT',exit:99.9,exit_at:iso(CLOSE-300000),return_pct:-.4};
 assert.deepEqual(manageMomentum(closed,input,{now:CLOSE}),closed);
});

test('stats separate milestone wins from green closes and hide percentages below n=20',()=>{
 const rows=[{id:'a',target_hit:true,state:'CLOSED',return_pct:-.1},{id:'b',target_hit:false,state:'CLOSED',return_pct:.1},{id:'c',target_hit:false,state:'TRACKING'}];
 const s=momentumStats(rows);assert.equal(s.n,2);assert.equal(s.wins,1);assert.equal(s.win_rate,null);assert.equal(s.closed_green,1);assert.equal(s.profit_factor,1);assert.equal(s.unresolved,1);assert.equal(s.interval.length,2);
 const expanded=Array.from({length:20},(_,i)=>({...rows[i%2],id:String(i)}));
 assert.equal(momentumStats(expanded).win_rate,.5);
});

test('source changes hold an existing observation and cannot overwrite its entry or win',()=>{
 const {calendar,input}=fixture();input.snapshot.health.source={feed_fingerprint:'original'};
 const c=momentumCandidates(input,calendar,{now:OPEN+540000}).candidates[0];
 assert.equal(c.source_fingerprint,'original');
 const p=manageMomentum(c,input,{now:OPEN+540000});input.snapshot.health.source.feed_fingerprint='replacement';
 const held=manageMomentum(p,input,{now:OPEN+600000});
 assert.equal(held.status,'DATA HOLD');assert.equal(held.target_hit,true);assert.equal(held.entry,p.entry);assert.equal(held.source_fingerprint,'original');
});

test('opposing events on the same confirmed bar are withheld instead of picking an arbitrary direction',()=>{
 const {calendar,input}=fixture('SPY',[candle(OPEN,100,100,99.9,100.1)]);
 input.overnight={low:99.95,high:100.05,asof:iso(OPEN),session_date:DAY,complete:true};
 const out=momentumCandidates(input,calendar,{now:OPEN+180000});
 assert.equal(out.candidates.length,0);assert.equal(out.rejected.length,2);assert.ok(out.rejected.every(c=>c.reason.includes('Conflicting directions')));
});

test('malformed persisted observations fail closed, including NaN and wrong stop geometry',()=>{
 const {input}=fixture(),c=candidate(input);
 assert.equal(validMomentumReservation(c),true);
 for(const bad of [{...c,side:0},{...c,atr:NaN},{...c,entry:Infinity},{...c,defended_level:{price:NaN}},{...c,entry_at:'bad'},{...c,entry:100.3,stop:99},{...c,levels:null},{...c,level_hits:{}},{...c,level_hits:[null]},{...c,last_price:NaN},{...c,target_hit_at:'bad'},{...c,state:'CORRUPT'}]){
   assert.equal(validMomentumReservation(bad),false);
   assert.equal(manageMomentum(bad,input,{now:OPEN+540000}).status,'DATA HOLD');
 }
});

test('pre-market references require the same date, full coverage and the session-open as-of',()=>{
 const {calendar,input}=fixture();const ref={low:99.99,high:101,complete:true,session_date:DAY,asof:iso(OPEN)};
 for(const wrong of [{...ref,complete:false},{...ref,complete:undefined},{...ref,session_date:'2026-10-22'},{...ref,asof:undefined},{...ref,asof:iso(OPEN-60000)}]){
   input.overnight=wrong;
   const out=momentumCandidates(input,calendar,{now:OPEN+540000});
   assert.equal(out.candidates.some(c=>c.setup_id==='PM_LOW_HOLD'),false);
 }
 input.overnight=ref;assert.ok(momentumCandidates(input,calendar,{now:OPEN+540000}).candidates.some(c=>c.setup_id==='PM_LOW_HOLD'));
});

test('tracking warns near the adverse stop and publishes its actual session deadline',()=>{
 const {input}=fixture('SPY',[candle(OPEN,100,100.3),candle(OPEN+180000,100.3,100.04,100.03,100.32)]);
 const p=manageMomentum(candidate(input,{defended_level:{label:'Earlier support',price:99.5}}),input,{now:OPEN+360000});
 assert.equal(p.status,'GET READY TO EXIT');assert.match(p.reason,/adverse stop/);assert.equal(p.tracking_deadline,iso(CLOSE-300000));
});

test('continuation progresses next-level labels without mutating the prior reservation',()=>{
 const {input}=fixture(),prior=manageMomentum(candidate(input),input,{now:OPEN+360000}),copy=JSON.stringify(prior);
 const next=manageMomentum(prior,input,{now:OPEN+540000});
 assert.equal(next.next_level.label,'+61.8');assert.equal(JSON.stringify(prior),copy);
});
