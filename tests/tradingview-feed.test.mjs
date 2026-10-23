import test from 'node:test';
import assert from 'node:assert/strict';
import {packTV,unpackTV,sourceIdentity,sourceFingerprint,confirmedBars,aggregateTenMinutes,readTradingView,openTradingViewSocket} from '../lib/tradingview-feed.mjs';
const NOW=Date.parse('2026-10-23T19:24:22Z');
const seconds=s=>Date.parse(s)/1000;
const value=(at,volume=100)=>[seconds(at),100,102,99,101,volume];
const frame=(m,p)=>packTV(m,p);
const minute=(at,volume=1)=>({time:at,open:100,high:102,low:99,close:101,volume});
class Socket extends EventTarget {
  sent=[];closed=false;symbol='';
  constructor({fail=false,source='BATS',delay=null,mismatch=false}={}){super();this.options={fail,source,delay,mismatch};}
  send(raw){
    const message=JSON.parse(unpackTV(raw)[0]);this.sent.push(message);
    const p=message.p;
    if(message.m==='resolve_symbol')this.symbol=JSON.parse(p[2].slice(1)).symbol;
    if(message.m!=='create_series')return;
    const [session,,,,interval]=p;
    queueMicrotask(()=>{
      if(this.closed)return;
      if(this.options.fail){this.dispatchEvent(new MessageEvent('message',{data:frame('symbol_error',[session,'symbol','invalid symbol'])}));return;}
      const meta={pro_name:this.symbol,source_id:this.options.mismatch&&interval==='D'?'OTHER':this.options.source,delay:this.options.delay};
      let values;
      if(interval==='D')values=[...Array.from({length:25},(_,i)=>value(new Date(Date.UTC(2026,8,i+1,13,30)).toISOString())),value('2026-10-23T13:30:00Z')];
      else if(interval==='1')values=Array.from({length:25},(_,i)=>value(new Date(Date.UTC(2026,9,23,19,i)).toISOString(),this.options.source==='TVC'?null:100));
      else values=['19:06','19:09','19:12','19:18','19:21','19:24'].map(time=>value('2026-10-23T'+time+':00Z',this.options.source==='TVC'?null:100));
      const data=frame('symbol_resolved',[session,'symbol',meta])+frame('timescale_update',[session,{series:{s:values.map(v=>({v}))}}])+frame('series_completed',[session,'series']);
      this.dispatchEvent(new MessageEvent('message',{data}));
    });
  }
  close(){this.closed=true;}
  accept(){}
}
test('TradingView framing preserves multiple messages and rejects truncated input',()=>{
  const a=packTV('one',['x']),b=packTV('two',[2]);assert.deepEqual(unpackTV(a+b).map(JSON.parse),[{m:'one',p:['x']},{m:'two',p:[2]}]);
  assert.throws(()=>unpackTV('~m~50~m~short'),/Truncated/);assert.throws(()=>unpackTV('invalid'),/Malformed/);
});
test('source fingerprint uses canonical sorted feed fields shared with Python replay',async()=>{
  const identity=sourceIdentity({source_id:'BATS',pro_name:'AMEX:SPY'},'AMEX:SPY');
  assert.deepEqual(identity,{adjustment:'splits',interval:'3m',pro_name:'AMEX:SPY',provider:'TradingView',session_basis:'RTH',source_id:'BATS',symbol:'AMEX:SPY'});
  assert.equal(await sourceFingerprint(identity),'sha256:0871282d71d54512594cd572403027f9b14e543690d40ecfb3bf94ae21bf7d85');
  assert.equal(await sourceFingerprint(identity),await sourceFingerprint(Object.fromEntries(Object.entries(identity).reverse())));
  assert.notEqual(await sourceFingerprint(identity),await sourceFingerprint({...identity,symbol:'NASDAQ:AAPL'}));
});
test('only completed regular-session 3m candles enter the engine, including DST',()=>{
  const bars=confirmedBars(['13:27','13:30','19:21','19:24','20:00'].map(time=>value('2026-10-23T'+time+':00Z')),3,NOW);
  assert.deepEqual(bars.map(b=>b.time),['2026-10-23T13:30:00.000Z','2026-10-23T19:21:00.000Z']);
  const winter=confirmedBars([value('2026-12-01T14:27:00Z'),value('2026-12-01T14:30:00Z')],3,Date.parse('2026-12-01T15:00:00Z'));
  assert.equal(winter.length,1);assert.equal(winter[0].time,'2026-12-01T14:30:00.000Z');
});
test('10m ribbon bars require ten contiguous confirmed 1m bars; index volume remains missing',()=>{
  const bars=Array.from({length:20},(_,i)=>minute(new Date(Date.UTC(2026,9,23,13,30+i)).toISOString(),null));
  const complete=aggregateTenMinutes(bars,Date.parse('2026-10-23T13:49:59Z'));
  assert.equal(complete.length,1);assert.equal(complete[0].time,'2026-10-23T13:30:00.000Z');assert.equal(complete[0].volume,null);
  assert.equal(aggregateTenMinutes(bars.filter((_,i)=>i!==4),Date.parse('2026-10-23T13:50:00Z')).length,1);
  assert.equal(aggregateTenMinutes([...bars.slice(0,9),bars[0]],NOW).length,0);
});
test('public feed uses three separate chart sessions with native 3m / 1m / daily, never forbidden 10m',async()=>{
  const socket=new Socket();const result=await readTradingView('SPY',{openSocket:async()=>socket,clock:()=>NOW});
  const requests=socket.sent.filter(m=>m.m==='create_series');assert.deepEqual(requests.map(m=>m.p[4]),['3','1','D']);assert.equal(new Set(requests.map(m=>m.p[0])).size,3);
  assert.equal(result.bars.at(-1).time,'2026-10-23T19:21:00.000Z');assert.equal(result.last_bar_close_at,'2026-10-23T19:24:00.000Z');
  assert.equal(result.trend_bars.length,2);assert.equal(result.daily.length,25);assert.equal(result.source.realtime,null);assert.equal(result.source.delay_seconds,null);assert.equal(socket.closed,true);
});
test('SPX prefers fresh TVC index, retains missing volume, and reports the attempted symbol',async()=>{
  const result=await readTradingView('SPX',{openSocket:async()=>new Socket({source:'TVC'}),clock:()=>NOW});
  assert.equal(result.tv_symbol,'TVC:SPX');assert.equal(result.volume_available,false);assert.equal(result.bars.at(-1).volume,null);
  assert.deepEqual(result.attempts.map(a=>a.symbol),['TVC:SPX']);
});
test('SPX tries SP fallback only after TVC fails and preserves known 600-second delay',async()=>{
  let attempts=0;const result=await readTradingView('SPX',{openSocket:async()=>++attempts===1?new Socket({fail:true}):new Socket({source:'SP',delay:600}),clock:()=>NOW});
  assert.deepEqual(result.attempts.map(a=>a.symbol),['TVC:SPX','SP:SPX']);assert.equal(result.source.delay_seconds,600);
  assert.equal(result.bars.at(-1).time,'2026-10-23T19:09:00.000Z');
});
test('daily/intraday source mismatch and total feed failures are explicit errors',async()=>{
  await assert.rejects(readTradingView('AAPL',{openSocket:async()=>new Socket({mismatch:true}),clock:()=>NOW}),/daily source differs/);
  await assert.rejects(readTradingView('SPX',{openSocket:async()=>new Socket({fail:true}),clock:()=>NOW}),error=>error.attempts.length===2&&/TVC:SPX/.test(error.message)&&/SP:SPX/.test(error.message));
});
test('Worker handshake asks only for the public WebSocket and carries no credentials',async()=>{
  const socket=new Socket();let request;
  assert.equal(await openTradingViewSocket({fetcher:async(url,options)=>{request={url,options};return {webSocket:socket,status:101};}}),socket);
  assert.equal(request.options.headers.Upgrade,'websocket');assert.equal(request.options.headers.Origin,'https://www.tradingview.com');
  assert.equal('Authorization' in request.options.headers,false);assert.equal('Cookie' in request.options.headers,false);
  await assert.rejects(openTradingViewSocket({fetcher:async()=>({status:403})}),/upgrade failed \(403\)/);
});
