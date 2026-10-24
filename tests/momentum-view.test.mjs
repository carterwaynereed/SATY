import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {momentumView,momentumCardHTML,watchView,watchHTML,statsView,priceText,currencyText} from '../site/momentum-view.mjs';
const now=Date.parse('2026-10-26T14:06:05Z');
const snapshot={health:{state:'CURRENT',price_asof:'2026-10-26T14:06:00Z'},session:{date:'2026-10-26',open:'2026-10-26T13:30:00Z',close:'2026-10-26T20:00:00Z'},market:{last:601},radar:{score:65,lean:1,highlight:true}};
const signal={symbol:'SPY',direction:'CALL',side:1,entry:600,target:{price:602.36},stop:597,structural_stop:{price:598},next_level:{price:602,label:'+61.8'},entry_at:'2026-10-26T14:03:00Z',status:'HOLD',state:'TRACKING',reason:'The defended level is holding.',levels_covered:1};
const fixture=()=>({symbols:{SPY:structuredClone(snapshot)},momentum:{session_date:'2026-10-26',signal:structuredClone(signal),state:'CURRENT',stats:{n:0}}});

// Fixed continuity contract captured from site/index.html at 7c25ba5. Keeping
// the IDs here also runs in CI's shallow checkout without fetching old history.
const referenceDeskIds=`ticker-select clock direction-radar desk refresh import export connection live-alerts level-bounce exit-panel readiness watchlist view-saty view-paper view-note chart-symbol price regime profile-label legend-one asof all-chart-levels chart chart-empty session-label source-label plan-model trade-plan paper study-status plan-note level-basis market-reference levels level-note uw-status uw-meta gamma-fields flow-fields dark-fields uw-notes decision signal-tag plan-summary gates indicator-summary ribbon-values phase-note weight-model scorebar scores-block call-score put-score wait-score weight-status features weight-math paper-gates setups setup-count setup-health evidence-state event-definition evidence-description signals evidence-period evidence-body evidence-method evidence-limitations journal export-journal paper-connection paper-owner-access paper-sign-in stats paper-event journal-rows groups playbook sources calendar-form event-source event-list calendar-confirm calendar-save calendar-help learning export-notes daily-research-summary learning-status challenger promotion-rules note-form note-source note-text notes candidate-count candidates policy-review toast`.split(' ');
function markupNodes(html){
  const nodes=[],stack=[],voidTags=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  for(const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b([^>]*)>/gi)){
    if(!match[1])continue;
    const tag=match[1].toLowerCase();
    if(match[0].startsWith('</')){const index=stack.findLastIndex(n=>n.tag===tag);if(index>=0)stack.length=index;continue;}
    const attrs=Object.fromEntries([...match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(a=>[a[1],a[2]??a[3]??a[4]??'']));
    const node={tag,attrs,hidden:stack.some(n=>n.hidden||n.tag==='details'&&!('open'in n.attrs))||'hidden'in attrs||attrs['aria-hidden']==='true'};
    nodes.push(node);if(!voidTags.has(tag)&&!match[0].endsWith('/>'))stack.push(node);
  }
  return nodes;
}

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
  const x=fixture();x.symbols.AAPL={...structuredClone(snapshot),radar:{score:85,lean:-1,highlight:true}};let rows=watchView(x,{now});assert.equal(rows[0].symbol,'AAPL');assert.equal(rows[0].highlight,true);assert.equal(rows.length,4);assert.equal(rows[0].directionTone,'bear');assert.equal(rows.find(r=>r.symbol==='SPY').directionTone,'bull');assert.equal(rows.find(r=>r.symbol==='SPX').directionTone,'inactive');assert.match(watchHTML(rows),/watch-lean bear/);rows=watchView(x,{now,failed:true});assert.equal(rows.some(r=>r.highlight),false);assert.ok(rows.every(r=>r.directionTone==='inactive'));
});
test('small samples and unavailable evidence never become a headline probability',()=>{
  assert.equal(statsView({n:0}).target,'Not enough data');assert.equal(statsView({n:19,win_rate:1}).target,'Not enough data');assert.equal(statsView({n:20,wins:16,win_rate:.8,closed_n:20,closed_green_rate:.5,profit_factor:1.2,interval:[.58,.92]}).target,'80%');assert.equal(statsView({n:20,closed_n:20,wins:16,win_rate:.8,closed_green_rate:.5}).green,'50%');assert.equal(statsView({n:20,closed_n:2,wins:16,win_rate:.8,closed_green_rate:.5}).green,'Not enough data');assert.equal(statsView({n:20,win_rate:1,state:'DATA HOLD'}).target,'Unavailable');assert.equal(statsView({n:0,unresolved_n:2}).unresolved,2);
  assert.equal(priceText(null),'—');assert.equal(priceText(0),'0.00');assert.equal(currencyText(0),'$0');
  assert.equal(statsView({n:null,state:'DATA HOLD'}).n,null);assert.equal(statsView({}).held,true);assert.equal(statsView({n:0}).held,false);
});
test('untrusted labels render as text and cannot inject markup',()=>{
  const x=fixture();Object.assign(x.momentum.signal,{setup:'<img src=x onerror=alert(1)>',reason:'<script>bad()</script>',levels_covered:'<svg onload=alert(1)>'});const html=momentumCardHTML(momentumView(x,{now}));assert.doesNotMatch(html,/<img|<script|<svg/);assert.match(html,/&lt;script&gt;/);assert.match(html,/0 levels covered/);
});
test('one tracker leads the visible full desk with unique IDs and retained reference panels',async()=>{
  const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8'),nodes=markupNodes(html),identified=nodes.filter(n=>n.attrs.id),ids=identified.map(n=>n.attrs.id),byId=new Map(identified.map(n=>[n.attrs.id,n]));
  assert.equal(new Set(ids).size,ids.length,'duplicate IDs split ticker updates between panels');
  for(const id of referenceDeskIds)assert.ok(byId.has(id),`missing original desk capability: ${id}`);
  for(const id of ['momentum-card','watch-strip','options-context','chart','levels','indicator-summary','ribbon-values','scores-block','features','setup-reference','exit-panel','level-bounce','live-alerts','tracker-evidence','setups','signals','journal','journal-rows','playbook','learning','note-form','notes']){
    assert.ok(byId.has(id),`missing visible section: ${id}`);assert.equal(byId.get(id).hidden,false,`${id} must be visible without opening Details or changing tabs`);
  }
  assert.ok(ids.indexOf('momentum-card')<ids.indexOf('chart'),'the daily tracker precedes the reference chart');
  assert.ok(nodes.some(n=>n.tag==='details'&&n.attrs.class==='second-signal'),'secondary watch stays optional');
  assert.match(html,/MOMENTUM IS THE ONLY LIVE SIGNAL/);assert.match(html,/href="eod\.html"/);assert.match(html,/Owner sign-in for the private journal/);
  assert.equal(byId.get('paper').hidden,true);assert.ok('disabled'in byId.get('paper').attrs,'the compatibility paper queue cannot act');
  assert.equal(nodes.some(n=>'data-order'in n.attrs),false);assert.doesNotMatch(html,/Buy now|Sell now|Place order/i);
});
test('full desk has one controller and the momentum module only renders supplied data',async()=>{
  const [html,desk,renderer]=await Promise.all(['index.html','desk.mjs','momentum-dashboard.mjs'].map(name=>readFile(new URL(`../site/${name}`,import.meta.url),'utf8')));
  const scripts=markupNodes(html).filter(n=>n.tag==='script');
  assert.equal(scripts.length,1);assert.equal(scripts[0].attrs.type,'module');assert.equal(scripts[0].attrs.src,'desk.mjs');
  assert.match(desk,/import\s*\{[^}]*renderMomentumDashboard[^}]*\}\s*from\s*['"]\.\/momentum-dashboard\.mjs['"]/);
  assert.match(renderer,/export function renderMomentumDashboard/);assert.doesNotMatch(renderer,/\bfetch\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(|createMarketReader\s*\(/,'renderer must not start a second data reader or timer');
});
test('early-close session shows its actual tracking deadline',()=>{
 const x=fixture();x.symbols.SPY.session.close='2026-10-26T17:00:00Z';const v=momentumView(x,{now});assert.equal(v.deadline,'12:55 PM ET');assert.match(momentumCardHTML(v),/tracking ends at 12:55 PM ET/);assert.doesNotMatch(momentumCardHTML(v),/3:55/);
});
