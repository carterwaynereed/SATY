import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionMode,shouldPoll} from '../site/session-mode.mjs';
import {exitModel,replayStat} from '../site/exit-panel.mjs';
import {extendedSnapshot,createExtendedReader} from '../lib/extended-hours.mjs';
import {readExtendedTradingView,packTV,unpackTV} from '../lib/tradingview-feed.mjs';
import {createWorker} from '../hosting/worker.mjs';
const t=s=>Date.parse(s),NOW=t('2026-10-23T18:00:10Z');
const calendar={sessions:{'2026-10-22':{open:'2026-10-22T13:30:00Z',close:'2026-10-22T20:00:00Z'},'2026-10-23':{open:'2026-10-23T13:30:00Z',close:'2026-10-23T20:00:00Z'},'2026-10-26':{open:'2026-10-26T13:30:00Z',close:'2026-10-26T20:00:00Z'}}};
function snapshot(side='LONG'){
 const short=side==='SHORT',base=short?101:99;
 const bars=Array.from({length:40},(_,i)=>({time:new Date(NOW-10_000-(40-i)*180000).toISOString(),open:100,high:100.1,low:99.9,close:100,ema8:100.2,ema34:100,phase:20,volume:10}));
 return {market:{symbol:'SPY',last:100,atr14:10,day_high:102,day_low:98,vwap:short?101:99},bars,one_minute_bars:[],one_minute_health:{state:'UNAVAILABLE'},session:{date:'2026-10-23',...calendar.sessions['2026-10-23']},health:{state:'CURRENT',price_asof:'2026-10-23T18:00:00Z',source:{baseline_compatible:true}},ribbon:{ema34:base},levels:[{label:short?'-23.6':'+23.6',price:base,multiple:short?-.236:.236},{label:short?'-38.2':'+38.2',price:short?98:102,multiple:short?-.382:.382},{label:short?'-61.8':'+61.8',price:short?96:104,multiple:short?-.618:.618}],signals:[{id:'test',side,entry:100,entry_at:bars[0].time,stop:short?103:97,status:'TRACKING',setup:'test',targets:[]}]};
}
test('ET polling boundaries, weekend and DST use local session hours',()=>{
 for(const [when,mode,ms] of [['2026-10-23T07:59:59Z','CLOSED',null],['2026-10-23T08:00:00Z','EXTENDED HOURS',60000],['2026-10-23T13:30:00Z','REGULAR',15000],['2026-10-23T20:00:00Z','EXTENDED HOURS',60000],['2026-10-24T00:00:00Z','CLOSED',null],['2026-10-24T14:00:00Z','CLOSED',null],['2026-12-01T09:00:00Z','EXTENDED HOURS',60000]]){const x=sessionMode(t(when));assert.equal(x.mode,mode,when);assert.equal(x.poll_ms,ms);}
 assert.equal(shouldPoll(t('2026-10-23T20:00:00Z'),t('2026-10-23T20:00:59Z')),false);
 assert.equal(shouldPoll(t('2026-10-23T20:00:00Z'),t('2026-10-23T20:01:00Z')),true);
 assert.equal(shouldPoll(0,t('2026-10-24T16:00:00Z')),false);
});
test('early-close calendar suppresses regular status',()=>assert.equal(sessionMode(t('2026-11-27T19:00:00Z'),{date:'2026-11-27',open:'2026-11-27T14:30:00Z',close:'2026-11-27T18:00:00Z'}).mode,'CLOSED'));
test('long and short choose next ATR target with direction-correct invalidation',()=>{
 for(const side of ['LONG','SHORT']){const x=exitModel(snapshot(side),{now:NOW});assert.equal(x.targets[0].price,side==='LONG'?102:98);assert.equal(x.stop.price,side==='LONG'?99:101);assert.equal(x.atr_used,.4);assert.ok(x.lines.some(l=>l.exitRole==='target'));assert.ok(x.lines.some(l=>l.exitRole==='stop'));}
});
test('stop touch beats same-candle target; stop hit stays latched in replay',()=>{
 const s=snapshot();s.bars.at(-2).low=96;s.bars.at(-2).high=105;const x=exitModel(s,{now:NOW});assert.equal(x.status,'STOP HIT');assert.equal(x.tone,'red');
});
test('just-touched target is not skipped; nearby target warns before touch',()=>{
 const s=snapshot();s.bars.at(-1).high=102.1;assert.equal(exitModel(s,{now:NOW}).status,'EXIT / TAKE PROFIT');
 s.bars.at(-1).high=100.1;s.market.last=101.1;assert.equal(exitModel(s,{now:NOW}).status,'GET READY TO EXIT');
});
test('confirmed ribbon loss exits; sparse data cues remain unavailable',()=>{
 const s=snapshot();s.ribbon.ema34=100.5;const x=exitModel(s,{now:NOW});assert.equal(x.status,'EXIT / TAKE PROFIT');assert.equal(x.checks.find(x=>x.label==='1m momentum divergence').met,null);s.market.vwap=null;assert.equal(exitModel(s,{now:NOW}).checks.find(x=>x.label==='Losing session VWAP').met,null);
});
test('stale/failed/closed setups never give a live HOLD and selection is ticker-local',()=>{
 const s=snapshot();assert.equal(exitModel(s,{now:NOW,failed:true}).status,'DATA HOLD');assert.equal(exitModel(s,{now:NOW+300000}).reference,true);s.signals[0].status='CLOSED';assert.match(exitModel(s,{now:NOW}).status,/REFERENCE/);s.signals.push({...s.signals[0],id:'chosen',side:'SHORT'});assert.equal(exitModel(s,{now:NOW,selectedId:'chosen'}).setup.side,'SHORT');assert.equal(exitModel(null,{now:NOW}).status,'NO ACTIVE SETUP');
});
test('manual EOD cue requires exact ticker, recent timestamp, and 15:30 window',()=>{
 const s=snapshot(),now=t('2026-10-23T19:40:00Z');s.health.price_asof=new Date(now-10000).toISOString();const manual={symbol:'SPY',asof:new Date(now-60000).toISOString(),method:'manual',expiry_scope:'0DTE',max_pain:{spot:100},gex:{nodes:[{strike:100,gamma:-9}]}};
 const cue=(m,n=now)=>exitModel(s,{now:n,manual:m}).checks.at(-1).met;
 assert.equal(cue(manual),true);assert.equal(cue({...manual,symbol:'SPX'}),null);assert.equal(cue({...manual,asof:new Date(now-3600000).toISOString()}),null);assert.equal(cue(manual,NOW),null);
});
test('only engine-measured exact replay event displays a rate with n and Wilson',()=>{
 const s=snapshot(),p={event:'T1 before original stop',n:19,display_probability:.64,interval:[.4,.8]};assert.doesNotMatch(replayStat({probability:p},s),/64%/);p.n=20;assert.match(replayStat({probability:p},s),/64%, n=20; Wilson 95% 40%–80%/);p.display_probability=null;assert.doesNotMatch(replayStat({probability:p},s),/64%/);
});
function extFeed(now){const daily=Array.from({length:150},(_,i)=>({time:new Date(t('2026-05-26T13:30:00Z')+i*86400000).toISOString(),open:100,high:102,low:98,close:100})).filter(b=>b.time.slice(0,10)<='2026-10-22');daily.push({time:'2026-10-22T13:30:00Z',open:100,high:102,low:98,close:100});return {symbol:'SPY',source:{session_basis:'EXTENDED'},daily,bars:[{time:new Date(now-70000).toISOString(),open:101,high:103,low:100,close:102}]};}
test('extended preview has own price/levels and no replay feed contract',()=>{
 const now=t('2026-10-23T12:00:10Z'),feed=extFeed(now),x=extendedSnapshot(feed,calendar,now);assert.equal(x.price,102);assert.equal(x.gap,2);assert.ok(Math.abs(x.gap_percent-2)<1e-10);assert.equal(x.stats_eligible,false);assert.equal(x.next_open,'2026-10-23T13:30:00Z');assert.equal(x.signals,undefined);assert.equal(x.evidence_weights,undefined);assert.equal(x.source.session_basis,'EXTENDED');assert.throws(()=>extendedSnapshot({...feed,bars:[]},calendar,now),/missing or stale/);assert.throws(()=>extendedSnapshot(extFeed(now-300000),calendar,now),/stale/);
});
test('extended reader coalesces 60-second requests, skips SPX/weekends/RTH and holds missing bars',async()=>{
 let now=t('2026-10-23T12:00:10Z'),calls=0;const read=createExtendedReader(calendar,{clock:()=>now,reader:async s=>{calls++;if(s==='AAPL')throw Error('No entitlement');return extFeed(now);}});
 const [a,b]=await Promise.all([read({}),read({})]);assert.equal(calls,3);assert.deepEqual(a,b);assert.equal(a.SPX.state,'CLOSED');assert.equal(a.AAPL.state,'DATA HOLD');assert.equal(a.SPY.state,'CURRENT');now+=59000;await read({});assert.equal(calls,3);now+=1000;await read({});assert.equal(calls,6);now=t('2026-10-24T12:00:10Z');assert.equal((await read({})).SPY.state,'CLOSED');assert.equal(calls,6);now=NOW;await read({});assert.equal(calls,6);
});
test('after-hours gap uses confirmed current RTH close only',async()=>{
 const now=t('2026-10-23T21:00:10Z'),reader=createExtendedReader(calendar,{clock:()=>now,reader:async()=>extFeed(now)}),s=snapshot();s.health.price_asof=calendar.sessions['2026-10-23'].close;s.market.last=101;
 const x=(await reader({symbols:{SPY:s}})).SPY;assert.equal(x.gap_basis,101);assert.equal(x.gap,1);assert.equal(x.next_open,calendar.sessions['2026-10-26'].open);
});
class ExtendedSocket extends EventTarget{
 sent=[];send(raw){const x=JSON.parse(unpackTV(raw)[0]);this.sent.push(x);if(x.m!=='create_series')return;const [session,,,,interval]=x.p;queueMicrotask(()=>{const at=interval==='1'?'2026-10-23T11:59:00Z':'2026-10-22T13:30:00Z';const values=[t(at)/1000,100,102,99,101,10];const data=packTV('symbol_resolved',[session,'symbol',{source_id:'BATS'}])+packTV('timescale_update',[session,{series:{s:[{v:values}]}}])+packTV('series_completed',[session,'series']);this.dispatchEvent(new MessageEvent('message',{data}));});}close(){}accept(){}
}
test('public transport explicitly requests extended session; regular-only result cannot masquerade as extended',async()=>{
 const socket=new ExtendedSocket(),now=t('2026-10-23T12:00:10Z');const feed=await readExtendedTradingView('SPY',{clock:()=>now,openSocket:async()=>socket});assert.equal(feed.bars.length,1);assert.equal(feed.source.session_basis,'EXTENDED');assert.deepEqual(socket.sent.filter(x=>x.m==='create_series').map(x=>x.p[4]),['1','D']);assert.deepEqual(socket.sent.filter(x=>x.m==='resolve_symbol').map(m=>JSON.parse(m.p[2].slice(1)).session),['extended','regular']);await assert.rejects(readExtendedTradingView('SPX'),/No extended session/);
});
test('ETag changes when only extended data changes; private endpoints stay denied',async()=>{
 let price=101;const worker=createWorker({},()=>{},()=>{},async()=>({generated_at:'same',symbols:{SPY:{health:{state:'CLOSED'}}},extended_hours:{SPY:{price:price++}}}));const req=()=>new Request('https://example.test/api/market');const a=await worker.fetch(req(),{}),b=await worker.fetch(req(),{});assert.notEqual(a.headers.get('etag'),b.headers.get('etag'));assert.equal((await worker.fetch(new Request('https://example.test/api/snapshot'),{})).status,401);
});
