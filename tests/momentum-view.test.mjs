import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {momentumView,momentumCardHTML,watchView,statsView,priceText,currencyText} from '../site/momentum-view.mjs';
const now=Date.parse('2026-10-26T14:06:05Z');
const snapshot={health:{state:'CURRENT',price_asof:'2026-10-26T14:06:00Z'},session:{date:'2026-10-26',open:'2026-10-26T13:30:00Z',close:'2026-10-26T20:00:00Z'},market:{last:601},radar:{score:65,lean:1,highlight:true}};
const signal={symbol:'SPY',direction:'CALL',side:1,entry:600,target:{price:602.36},stop:597,structural_stop:{price:598},next_level:{price:602,label:'+61.8'},entry_at:'2026-10-26T14:03:00Z',status:'HOLD',state:'TRACKING',reason:'The defended level is holding.',levels_covered:1};
const fixture=()=>({symbols:{SPY:structuredClone(snapshot)},momentum:{session_date:'2026-10-26',signal:structuredClone(signal),state:'CURRENT',stats:{n:0}}});

test('momentum card distinguishes target milestone, next ladder and both stop rules',()=>{
  const v=momentumView(fixture(),{now}),html=momentumCardHTML(v);
  assert.equal(v.status,'HOLD');assert.equal(v.tone,'green');assert.equal(v.entry,600);assert.equal(v.target,602.36);assert.equal(v.nextLevel,602);
  assert.match(html,/602\.36/);assert.match(html,/602\.00/);assert.match(html,/close below 598\.00/);assert.match(html,/1 level covered/);assert.match(html,/0\.236 daily ATR/);
});
test('freshness, failed reads and closed sessions never show a live HOLD',()=>{
  assert.equal(momentumView(fixture(),{now,failed:true}).status,'DATA HOLD');
  assert.equal(momentumView(fixture(),{now:now+226000}).status,'WAIT');
  const stale=fixture();stale.symbols.SPY.health.state='STALE';assert.equal(momentumView(stale,{now}).status,'DATA HOLD');
  const dated=momentumView(fixture(),{now:Date.parse('2026-10-27T14:00:00Z')});assert.equal(dated.status,'WAIT');assert.equal(dated.reference,true);assert.match(dated.reason,/Oct 26/);
  assert.equal(momentumView(fixture(),{now:Date.parse('2026-10-26T20:01:00Z')}).status,'WAIT');
});
test('storage holds override tracking and pending entries do not manufacture entry prices',()=>{
  const held=fixture();held.momentum.state='DATA HOLD';held.momentum.reason='Signal storage unavailable';assert.equal(momentumView(held,{now}).status,'DATA HOLD');
  const pending=fixture();Object.assign(pending.momentum.signal,{entry:null,entry_at:null,state:'PENDING_ENTRY',status:'WAIT'});const v=momentumView(pending,{now});assert.equal(v.entry,null);assert.equal(v.status,'WAIT');assert.match(v.reason,/next-bar/);
  const reference=fixture();Object.assign(reference.momentum.signal,{live:false,read_only:true});assert.equal(momentumView(reference,{now}).status,'DATA HOLD');
});
test('GET READY is a distinct amber alert without invented take-profit advice',()=>{
  const x=fixture();x.momentum.signal.status='GET READY TO EXIT';x.momentum.signal.reason='The move is slowing. Watch the defended level.';const v=momentumView(x,{now});assert.equal(v.tone,'amber');assert.match(momentumCardHTML(v),/GET READY TO EXIT/);assert.doesNotMatch(momentumCardHTML(v),/trim|take profit/i);
});
test('next-day and missing feeds never turn the optional second watch into a live signal',()=>{
  const x=fixture();x.momentum.signal=null;x.momentum.second_signal={symbol:'AAPL',side:-1,setup:'Pre-market rejection',watch_only:true};const v=momentumView(x,{now});assert.equal(v.issued,0);assert.equal(v.signal,null);assert.match(v.secondText,/research only/);assert.equal(v.title,'Waiting for a clear move.');
});
test('watch strip ranks scores but never highlights stale observations',()=>{
  const x=fixture();x.symbols.AAPL={...structuredClone(snapshot),radar:{score:85,lean:-1,highlight:true}};let rows=watchView(x,{now});assert.equal(rows[0].symbol,'AAPL');assert.equal(rows[0].highlight,true);assert.equal(rows.length,4);rows=watchView(x,{now,failed:true});assert.equal(rows.some(r=>r.highlight),false);
});
test('small samples and unavailable evidence never become a headline probability',()=>{
  assert.equal(statsView({n:0}).target,'Not enough data');assert.equal(statsView({n:19,win_rate:1}).target,'Not enough data');assert.equal(statsView({n:20,wins:16,win_rate:.8,closed_n:20,closed_green_rate:.5,profit_factor:1.2,interval:[.58,.92]}).target,'80%');assert.equal(statsView({n:20,closed_n:20,wins:16,win_rate:.8,closed_green_rate:.5}).green,'50%');assert.equal(statsView({n:20,closed_n:2,wins:16,win_rate:.8,closed_green_rate:.5}).green,'Not enough data');assert.equal(statsView({n:20,win_rate:1,state:'DATA HOLD'}).target,'Unavailable');assert.equal(statsView({n:0,unresolved_n:2}).unresolved,2);
  assert.equal(priceText(null),'—');assert.equal(priceText(0),'0.00');assert.equal(currencyText(0),'$0');
  assert.equal(statsView({n:null,state:'DATA HOLD'}).n,null);assert.equal(statsView({}).held,true);assert.equal(statsView({n:0}).held,false);
});
test('untrusted labels render as text and cannot inject markup',()=>{
  const x=fixture();Object.assign(x.momentum.signal,{setup:'<img src=x onerror=alert(1)>',reason:'<script>bad()</script>',levels_covered:'<svg onload=alert(1)>'});const html=momentumCardHTML(momentumView(x,{now}));assert.doesNotMatch(html,/<img|<script|<svg/);assert.match(html,/&lt;script&gt;/);assert.match(html,/0 levels covered/);
});
test('main screen has one tracker, collapsed details and no order controls',async()=>{
  const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');assert.equal((html.match(/id="momentum-card"/g)??[]).length,1);assert.match(html,/<details class="details-section" id="details">/);assert.match(html,/<details class="second-signal">/);assert.doesNotMatch(html,/id="level-bounce"|id="live-alerts"|id="paper"|data-order|Buy now|Sell now/);assert.match(html,/details\.html\?journal=1/);
});
test('early-close session shows its actual tracking deadline',()=>{
 const x=fixture();x.symbols.SPY.session.close='2026-10-26T17:00:00Z';const v=momentumView(x,{now});assert.equal(v.deadline,'12:55 PM ET');assert.match(momentumCardHTML(v),/tracking ends at 12:55 PM ET/);assert.doesNotMatch(momentumCardHTML(v),/3:55/);
});
