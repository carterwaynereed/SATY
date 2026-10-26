import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedHourly,hourlyEthContext} from '../lib/hourly-eth.mjs';
import {createExtendedReader} from '../lib/extended-hours.mjs';
import {readHourlyExtended,packTV,unpackTV} from '../lib/tradingview-feed.mjs';
import {paint} from '../site/hourly-eth-view.mjs';
const t=s=>Date.parse(s);
const NOW=t('2026-10-23T16:00:00Z');
function hours(n,{close=()=>100,span=0.1,start='2026-10-21T08:00:00Z',now=NOW}={}){
 const bars=[];let at=t(start);
 while(bars.length<n){
  const hour=new Date(at).getUTCHours();
  if(hour>=8&&hour<=23&&at+3600000<=now){const c=close(bars.length);bars.push({time:new Date(at).toISOString(),open:c,high:c+span/2,low:c-span/2,close:c});}
  at+=3600000;
 }
 return bars;
}
const wide=i=>i<37?100:100+((i-36)*8);
test('confirmed hourly bars stay inside 04:00–20:00 ET and drop a forming hour',()=>{
 const rows=hours(3).concat([{time:'2026-10-23T07:00:00Z',open:100,high:101,low:99,close:100},{time:'2026-10-23T15:30:00Z',open:100,high:101,low:99,close:100},{time:'2026-10-23T12:00:00Z',open:100,high:101,low:99,close:100}]);
 const kept=confirmedHourly(rows,NOW).map(b=>b.time);
 assert.equal(kept.includes('2026-10-23T07:00:00.000Z'),false);
 assert.equal(kept.includes('2026-10-23T15:30:00.000Z'),false);
 assert.equal(kept.filter(x=>x.startsWith('2026-10-23T12:00')).length,1);
});
test('hourly TTM and 10/21 EMAs are ETH context and stay off the evidence contract',()=>{
 const flat=hourlyEthContext(hours(40),{symbol:'SPY',now:NOW});
 assert.equal(flat.state,'ON');assert.equal(flat.label,'hourly TTM');assert.equal(flat.session_basis,'ETH');
 assert.equal(flat.stats_eligible,false);assert.equal(flat.signals,null);assert.equal(flat.evidence_weights,null);
 assert.equal(flat.ema10,100);assert.equal(flat.ema21,100);assert.equal(flat.vs21,'at');assert.equal(flat.momentum,null);
 const jump=hourlyEthContext(hours(40,{close:i=>i===39?110:100,span:0.1}),{symbol:'AAPL',now:NOW});
 assert.equal(jump.state,'FIRING');assert.equal(jump.vs10,'above');assert.equal(jump.vs21,'above');assert.equal(jump.momentum,'up');
 assert.ok(Math.abs(jump.ema10-(110*2/11+100*9/11))<1e-9);assert.ok(Math.abs(jump.ema21-(110/11+100*10/11))<1e-9);
 const release=hourlyEthContext(hours(40,{close:wide,span:0.1}),{now:NOW});
 assert.equal(release.state,'RELEASE');
 const off=hourlyEthContext(hours(40,{close:i=>100+i,span:0.1}),{now:NOW});
 assert.equal(off.state,'OFF');
 assert.equal(hourlyEthContext([],{symbol:'SPX'}).state,'CLOSED');
 assert.match(hourlyEthContext(hours(12),{now:NOW}).reason,/12 confirmed bars/);
 const rth=[];let at=t('2026-10-21T13:30:00Z');
 while(rth.length<40){const minute=(new Date(at).getUTCHours()-4)*60;if(minute>=570&&minute<960)rth.push({time:new Date(at).toISOString(),open:100,high:100.2,low:99.8,close:100});at+=3600000;}
 assert.match(hourlyEthContext(rth,{now:NOW+20*86400000}).reason,/no extended-hours/);
});
test('hourly reader holds a bad feed without touching the RTH snapshot',async()=>{
 const calendar={sessions:{'2026-10-22':{open:'2026-10-22T13:30:00Z',close:'2026-10-22T20:00:00Z'},'2026-10-23':{open:'2026-10-23T13:30:00Z',close:'2026-10-23T20:00:00Z'}}};
 const daily=Array.from({length:150},(_,i)=>({time:new Date(t('2026-05-26T13:30:00Z')+i*86400000).toISOString(),open:100,high:102,low:98,close:100})).filter(b=>b.time.slice(0,10)<='2026-10-22');
 let now=t('2026-10-23T13:29:00Z'),hourCalls=0,fail=false;
 const one=()=>({symbol:'SPY',source:{session_basis:'EXTENDED'},daily,bars:[{time:new Date(now-70000).toISOString(),open:101,high:103,low:100,close:102}]});
 const hourly=hours(40,{now,start:'2026-10-20T08:00:00Z'});
 const read=createExtendedReader(calendar,{clock:()=>now,reader:async()=>one(),hourlyReader:async symbol=>{hourCalls++;assert.notEqual(symbol,'SPX');if(fail)throw Error('hourly socket closed');return {bars:hourly};}});
 const regular={symbols:{SPY:{bars:[{time:'rth-only'}],evidence_weights:{call:40},health:{state:'CURRENT',price_asof:'2026-10-23T13:31:00Z'},market:{last:130}}}};
 const first=await read(regular);
 assert.equal(hourCalls,3);assert.equal(first.SPY.hourly.state,'ON');assert.equal(first.SPY.hourly.price_basis,'extended last');assert.equal(first.SPY.hourly.price,102);assert.equal(first.SPY.hourly.stats_eligible,false);
 assert.equal(first.SPX.hourly.state,'CLOSED');assert.deepEqual(regular.symbols.SPY.bars,[{time:'rth-only'}]);assert.equal(regular.symbols.SPY.evidence_weights.call,40);
 now=t('2026-10-23T13:31:00Z');const rth=await read(regular);assert.equal(hourCalls,3);assert.equal(rth.SPY.state,'CLOSED');assert.equal(rth.SPY.hourly.price,130);assert.equal(rth.SPY.hourly.price_basis,'RTH last');assert.equal(rth.SPY.hourly.vs21,'above');
 now+=300000;fail=true;const held=await read(regular);assert.equal(hourCalls,6);assert.equal(held.SPY.hourly.ema21,100);assert.equal(held.SPY.hourly.state,'ON');
 now=t('2026-10-24T16:00:00Z');assert.equal((await read(regular)).SPY.state,'CLOSED');assert.equal(hourCalls,6);
});
class HourSocket extends EventTarget{
 sent=[];
 constructor(kind){super();this.kind=kind;}
 send(raw){const x=JSON.parse(unpackTV(raw)[0]);this.sent.push(x);if(x.m!=='create_series')return;const [session]=x.p;queueMicrotask(()=>{
  const values=this.kind==='rth'?[[t('2026-10-23T13:30:00Z')/1000,100,101,99,100,1]]:[[t('2026-10-23T12:00:00Z')/1000,100,101,99,100,1],[t('2026-10-23T16:30:00Z')/1000,100,101,99,100,1]];
  const data=packTV('symbol_resolved',[session,'symbol',{source_id:'BATS',delay:this.kind==='delay'?15:0}])+packTV('timescale_update',[session,{series:{s:values.map(v=>({v}))}}])+packTV('series_completed',[session,'series']);
  this.dispatchEvent(new MessageEvent('message',{data}));
 });}
 close(){}accept(){}
}
test('hourly transport requests extended 60-minute bars and refuses a regular-only series',async()=>{
 const socket=new HourSocket('eth'),now=t('2026-10-23T17:00:00Z');
 const feed=await readHourlyExtended('SPY',{clock:()=>now,openSocket:async()=>socket});
 assert.equal(feed.bars.length,1);assert.equal(feed.source.session_basis,'ETH');assert.equal(feed.source.interval,'60');
 assert.deepEqual(socket.sent.filter(x=>x.m==='create_series').map(x=>x.p[4]),['60']);
 assert.deepEqual(socket.sent.filter(x=>x.m==='resolve_symbol').map(m=>JSON.parse(m.p[2].slice(1)).session),['extended']);
 await assert.rejects(readHourlyExtended('SPX'),/No extended session/);
 await assert.rejects(readHourlyExtended('SPY',{clock:()=>now,openSocket:async()=>new HourSocket('rth')}),/no extended-hours bars/);
 await assert.rejects(readHourlyExtended('SPY',{clock:()=>now,openSocket:async()=>new HourSocket('delay')}),/delayed bars/);
});
test('desk hourly readout names the squeeze and both EMAs, or the hold reason',()=>{
 const nodes=[];
 function el(tag){
  const node={tag,dataset:{},className:'',textContent:'',children:[],id:'',title:''};
  node.append=(...xs)=>{for(const x of xs){x.parent=x.parentElement=node;node.children.push(x);}};
  node.querySelector=sel=>{const hit=c=>(sel==='[data-h]'&&c.dataset?.h)||(sel==='[data-eth]'&&c.dataset?.eth);const walk=n=>{for(const c of n.children||[]){if(hit(c))return c;const found=walk(c);if(found)return found;}return null;};return walk(node);};
  node.querySelectorAll=sel=>sel==='[data-eth-level]'?node.children.filter(c=>c.dataset?.ethLevel):[];
  node.remove=function(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);};
  nodes.push(node);return node;
 }
 const head=el('head'),chart=el('canvas'),wrap=el('div'),levels=el('div');chart.id='chart';levels.id='levels';wrap.append(chart);
 const doc={createElement:el,head,getElementById:id=>nodes.find(n=>n.id===id)||null};globalThis.document=doc;
 const host=el('div');host.ownerDocument=doc;const ctx=hourlyEthContext(hours(40,{close:i=>i===39?110:100}),{symbol:'SPY',now:NOW});
 paint(host,ctx);paint(host,ctx);
 assert.equal(host.children.length,1);assert.equal(wrap.children.filter(c=>c.dataset.eth).length,1);assert.equal(wrap.querySelector('[data-eth]').children.length,3);assert.equal(levels.children.length,2);
 assert.match(host.children[0].children[0].children[1].textContent,/FIRING/);
 assert.match(wrap.querySelector('[data-eth]').children[0].children[1].textContent,/FIRING/);
 assert.match(levels.children[0].children[0].textContent,/h10 ETH/);assert.match(levels.children[1].children[0].textContent,/h21 ETH/);
 paint(host,{state:'DATA HOLD',reason:'Hourly feed reports delayed bars',session_basis:'ETH',stats_eligible:false,signals:null});
 assert.match(host.children[0].children[1].children[1].textContent,/delayed bars/);assert.equal(levels.children.length,0);
});
