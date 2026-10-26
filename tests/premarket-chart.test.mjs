import test from 'node:test';
import assert from 'node:assert/strict';
import {premarketChartModel,candleStyle,paintPremarketCue,etClock} from '../site/premarket-chart.mjs';
import {aggregatePremarketBars,premarketChartContext,createExtendedReader} from '../lib/extended-hours.mjs';
import {buildLiveSnapshot,replaySaty,rthSessionBars} from '../lib/saty-live.mjs';

const t=s=>Date.parse(s);
const calendar={sessions:{'2026-10-22':{open:'2026-10-22T13:30:00.000Z',close:'2026-10-22T20:00:00.000Z'},'2026-10-23':{open:'2026-10-23T13:30:00.000Z',close:'2026-10-23T20:00:00.000Z'},'2026-10-26':{open:'2026-10-26T13:30:00.000Z',close:'2026-10-26T20:00:00.000Z'},'2026-12-01':{open:'2026-12-01T14:30:00.000Z',close:'2026-12-01T21:00:00.000Z'}}};
const px=(time,close=100,high=101,low=99)=>({time,open:close,high,low,close,volume:10});
function minutes(start,count,close=100){return Array.from({length:count},(_,i)=>px(new Date(t(start)+i*60000).toISOString(),close+i/100,close+1,close-1));}

test('pre-market buckets keep 04:00–09:29 and drop 03:59, 09:30, gaps, and unconfirmed minutes',()=>{
 const now=t('2026-10-23T13:30:10Z');
 const bars=[px('2026-10-23T07:59:00Z',90,91,89),...minutes('2026-10-23T08:00:00Z',3,100),px('2026-10-23T08:03:00Z'),px('2026-10-23T08:05:00Z'),...minutes('2026-10-23T13:27:00Z',3,110),px('2026-10-23T13:30:00Z',120,121,119),px('2026-10-23T13:31:00Z',1,2,.5)];
 const x=aggregatePremarketBars(bars,'2026-10-23',now);
 assert.equal(x.bars.length,2);
 assert.equal(etClock(x.bars[0].time).hm,'04:00');
 assert.equal(etClock(x.bars[1].time).hm,'09:27');
 assert.equal(x.bars[0].open,100);assert.equal(x.bars[0].close,100.02);assert.equal(x.bars[0].session,'premarket');
 assert.ok(x.bars.every(b=>etClock(b.time).hm>='04:00'&&etClock(b.time).hm<'09:30'));
 assert.equal(x.complete,false);
 const forming=aggregatePremarketBars(minutes('2026-10-23T08:00:00Z',3),'2026-10-23',t('2026-10-23T08:02:30Z'));
 assert.equal(forming.bars.length,0);assert.equal(forming.one_count,2);
});

test('December EST 04:00 is included and 03:59 stays out',()=>{
 const bars=[px('2026-12-01T08:59:00Z',1,2,.5),...minutes('2026-12-01T09:00:00Z',3,50)];
 const x=aggregatePremarketBars(bars,'2026-12-01',t('2026-12-01T09:04:00Z'));
 assert.equal(x.bars.length,1);assert.equal(etClock(x.bars[0].time).hm,'04:00');assert.equal(x.high,51);
});

test('pre-market context reports gap, ATR distance, and overnight range without RTH fields',()=>{
 const now=t('2026-10-23T12:00:10Z');
 const daily=Array.from({length:120},(_,i)=>({time:new Date(t('2026-06-01T13:30:00Z')+i*86400000).toISOString(),open:100,high:104,low:96,close:100})).filter(b=>b.time.slice(0,10)<='2026-10-22');
 const feed={daily,bars:[px('2026-10-22T20:00:00Z',100,106,98),px('2026-10-22T23:59:00Z',100,107,97),...minutes('2026-10-23T08:00:00Z',6,102)]};
 const x=premarketChartContext(feed,calendar,now);
 assert.equal(x.stats_eligible,false);assert.equal(x.evidence_weights,undefined);assert.equal(x.signals,undefined);assert.equal(x.session_basis,'PREMARKET');
 assert.equal(x.bars.length,2);assert.equal(x.high,103);assert.equal(x.low,101);assert.equal(x.overnight_high,107);assert.equal(x.overnight_low,97);assert.equal(x.after_hours_observed,true);
 assert.equal(x.gap_basis,100);assert.ok(Math.abs(x.gap-(102.05-100))<1e-9);assert.ok(x.gap_atr>0);assert.equal(x.coverage,'partial');
 assert.ok(x.bars.every(b=>etClock(b.time).hm<'09:30'));
});

test('chart keeps pre-market before the open and beside RTH after it, and never mutates RTH bars',()=>{
 const pre={date:'2026-10-23',state:'CURRENT',coverage:'partial',stats_eligible:false,price:105,price_asof:'2026-10-23T12:03:00Z',high:106,low:101,gap:5,gap_atr:.5,atr14:10,after_hours_observed:false,bars:[{time:'2026-10-23T08:00:00Z',open:104,high:106,low:101,close:105}]};
 const rth=[{time:'2026-10-23T13:30:00Z',open:103,high:104,low:102,close:103.5,ema8:103,ema21:102,vwap:103}];
 const frozen=structuredClone(rth);
 const before=premarketChartModel(rth,{premarket:pre},{mode:'EXTENDED HOURS',minute:8*60,rthDate:'2026-10-22',calendarDay:'2026-10-23',prevClose:100,atr:10,now:t('2026-10-23T12:03:00Z')});
 assert.equal(before.sessionTag,'PRE-MARKET');assert.equal(before.bars.length,1);assert.equal(before.bars[0].session,'premarket');assert.equal(before.bars[0].ema13,undefined);
 assert.equal(before.quote,105);assert.equal(before.openIndex,null);assert.equal(before.statsEligible,undefined);
 assert.deepEqual(before.references.find(x=>x[0]==='GAP preview'),['GAP preview','+5.00 · +0.50 ATR']);
 const monday=premarketChartModel([{time:'2026-10-23T19:57:00Z',open:100,high:101,low:99,close:110}],{premarket:{...pre,date:'2026-10-26',price:112,gap:99,bars:[{time:'2026-10-26T08:00:00Z',open:111,high:113,low:110,close:112}]}},{mode:'EXTENDED HOURS',minute:500,rthDate:'2026-10-23',calendarDay:'2026-10-26',prevClose:100,atr:10,now:t('2026-10-26T12:00:00Z')});
 assert.equal(monday.sessionTag,'PRE-MARKET');assert.deepEqual(monday.references.find(x=>x[0]==='Last RTH close'),['Last RTH close','110.00']);assert.deepEqual(monday.references.find(x=>x[0]==='GAP preview'),['GAP preview','+2.00 · +0.20 ATR']);
 const after=premarketChartModel(rth,{premarket:pre},{mode:'REGULAR',minute:10*60,rthDate:'2026-10-23',calendarDay:'2026-10-23',prevClose:100,atr:10,now:t('2026-10-23T14:00:00Z')});
 assert.equal(after.sessionTag,'PRE-MARKET + RTH');assert.equal(after.openIndex,1);assert.equal(after.bars[1].session,'rth');assert.equal(after.bars[1].ema13,103);assert.equal(after.quote,null);
 assert.deepEqual(after.references.find(x=>x[0]==='GAP vs prior close'),['GAP vs prior close','+3.00 · +0.30 ATR']);
 assert.deepEqual(rth,frozen);
 const rejected=premarketChartModel(rth,{premarket:{...pre,bars:[...pre.bars,{time:'2026-10-23T13:30:00Z',open:1,high:2,low:.5,close:1},{time:'2026-10-23T07:59:00Z',open:1,high:2,low:.5,close:1}]}},after&&{mode:'REGULAR',minute:600,rthDate:'2026-10-23',calendarDay:'2026-10-23',prevClose:100,atr:10,now:t('2026-10-23T14:00:00Z')});
 assert.equal(rejected.bars.filter(b=>b.session==='premarket').length,1);
 const held=premarketChartModel(rth,{state:'DATA HOLD',reason:'missing'},{mode:'EXTENDED HOURS',minute:500,rthDate:'2026-10-22',calendarDay:'2026-10-23',now:t('2026-10-23T12:00:00Z')});
 assert.equal(held.sessionTag,'PRE-MARKET DATA HOLD');assert.equal(held.bars[0].session,'rth');assert.match(held.note,/no invented/);
 const spx=premarketChartModel(rth,{premarket:{state:'CLOSED',reason:'SPX has no extended session',bars:[],stats_eligible:false}},{mode:'REGULAR',minute:600,rthDate:'2026-10-23',calendarDay:'2026-10-23',now:t('2026-10-23T14:00:00Z')});
 assert.equal(spx.bars.length,1);assert.equal(spx.sessionTag,'RTH');assert.deepEqual(spx.references,[['PRE-MARKET','Unavailable']]);
});

test('1m extended bars are not drawn unless the server already folded them into pre-market candles',()=>{
 const bars=minutes('2026-10-23T08:00:00Z',3,100);
 const model=premarketChartModel([],{period:'PRE-MARKET',date:'2026-10-23',state:'CURRENT',bars,price:100.02},{mode:'EXTENDED HOURS',minute:8*60+3,calendarDay:'2026-10-23',rthDate:'2026-10-22',now:t('2026-10-23T12:03:00Z')});
 assert.equal(model.bars.length,0);assert.equal(model.sessionTag,'PRE-MARKET DATA HOLD');assert.equal(model.statsEligible,undefined);
});

test('candle color and 09:30 marker stay distinct from RTH',()=>{
 const palette={amber:'#ffd078',preDown:'#d7a8b8',bull:'#68e0a5',bear:'#ff8d99'};
 assert.equal(candleStyle({session:'premarket',c:2,o:1},palette).color,'#ffd078');
 assert.equal(candleStyle({session:'premarket',c:1,o:2},palette).color,'#d7a8b8');
 assert.equal(candleStyle({session:'rth',c:2,o:1},palette).color,'#68e0a5');
 assert.ok(candleStyle({session:'premarket',c:2,o:1},palette).alpha<1);
 const calls=[];const ctx={save(){},restore(){},beginPath(){},moveTo(x){calls.push(['move',x]);},lineTo(){},stroke(){},setLineDash(){},fillText(text){calls.push(['text',text]);}};
 assert.equal(paintPremarketCue(ctx,{boundary:40,top:0,bottom:10,color:'#ffd078'}),true);
 assert.deepEqual(calls.find(c=>c[0]==='text'),['text','09:30']);assert.equal(paintPremarketCue(ctx,{boundary:NaN}),false);
});

function rthFeed(now){
 const days=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23'];
 const bars=[];
 for(const day of days)for(let start=t(day+'T13:30:00Z');start<t(day+'T20:00:00Z')&&start+180000<=now;start+=180000)bars.push(px(new Date(start).toISOString(),100,101,99));
 const daily=[];
 for(let date=t('2026-03-02T13:30:00Z');date<t('2026-10-23T13:30:00Z');date+=86400000)if(![0,6].includes(new Date(date).getUTCDay()))daily.push(px(new Date(date).toISOString(),100,101,99));
 const sessions={};
 for(const day of days)sessions[day]={open:day+'T13:30:00.000Z',close:day+'T20:00:00.000Z'};
 return {feed:{symbol:'SPY',source:{feed_fingerprint:'sha256:premarket-test',provider:'TradingView',source_id:'BATS'},bars,daily,one_bars:[],trend_bars:[],attempts:[]},sessions};
}

test('pre-market prints cannot change RTH replay, snapshot bars, or evidence weights',()=>{
 const now=t('2026-10-23T14:06:00Z'),base=rthFeed(now),pre=px('2026-10-23T12:00:00Z',40,80,30);
 const clean=replaySaty(base.feed.bars,base.feed.daily,'2026-10-23');
 const mixed=replaySaty([pre,...base.feed.bars],base.feed.daily,'2026-10-23');
 assert.equal(rthSessionBars([pre,...base.feed.bars]).some(b=>etClock(b.time).hm<'09:30'),false);
 assert.equal(mixed.today.length,clean.today.length);assert.equal(mixed.today[0].time,clean.today[0].time);
 assert.equal(mixed.indicators.at(-1).e8,clean.indicators.at(-1).e8);assert.equal(mixed.events.length,clean.events.length);
 const plain=buildLiveSnapshot(base.feed,null,{sessions:base.sessions},now);
 const dirty=buildLiveSnapshot({...base.feed,bars:[pre,...base.feed.bars]},null,{sessions:base.sessions},now);
 assert.equal(etClock(plain.bars[0].time).hm,'09:30');assert.equal(dirty.bars.length,plain.bars.length);
 assert.deepEqual(dirty.evidence_weights.features,plain.evidence_weights.features);
 assert.deepEqual(dirty.ribbon,plain.ribbon);assert.equal(dirty.signals.length,plain.signals.length);
 assert.ok(dirty.bars.every(b=>etClock(b.time).hm>='09:30'&&etClock(b.time).hm<'16:00'));
});

test('regular session serves cached pre-market once and does not let it touch the RTH snapshot',async()=>{
 let now=t('2026-10-23T14:00:10Z'),calls=[];
 const read=createExtendedReader(calendar,{clock:()=>now,reader:async symbol=>{calls.push(symbol);if(symbol==='SPX')throw Error('SPX must not be read');return {daily:[],bars:minutes('2026-10-23T08:00:00Z',3)};}});
 const regular={symbols:{SPY:{bars:[{time:'rth-only'}],evidence_weights:{call:40}}}};
 const first=await read(regular);assert.deepEqual(calls.slice().sort(),['AAPL','GOOGL','SPY']);assert.equal(first.SPX.premarket.reason,'SPX has no extended session');assert.equal(first.SPX.premarket.bars.length,0);
 assert.equal(first.SPY.state,'CLOSED');assert.equal(first.SPY.premarket.stats_eligible,false);assert.equal(first.SPY.premarket.evidence_weights,undefined);assert.equal(first.SPY.premarket.bars.length,1);
 assert.deepEqual(regular.symbols.SPY.bars,[{time:'rth-only'}]);assert.equal(regular.symbols.SPY.evidence_weights.call,40);
 now+=1000;await read(regular);assert.equal(calls.length,3);
 now=t('2026-10-24T14:00:00Z');assert.equal((await read(regular)).SPY.state,'CLOSED');assert.equal(calls.length,3);
});
