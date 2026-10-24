import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUW,maxPainLean} from '../site/uw-view.mjs';

const NOW = Date.parse('2026-10-23T14:00:00Z');
const base = () => ({schema_version:1, status:'live', source:'Unusual Whales', symbol:'SPY', asof:'2026-10-23T13:59:00Z', ttl_minutes:15,
  gamma:{call_wall:600.25, put_wall:590.125, zero_gamma:595.5}, flow:{net_premium:0}, max_pain:595,
  market_tide:{scope:'market-wide', net_call_premium:1000000, net_put_premium:-250000}});

test('UW preserves precise prices and zero premium without converting ticker units', () => {
  const view = normalizeUW(base(), {symbol:'SPY',now:NOW});
  assert.equal(view.state,'CURRENT');
  assert.equal(view.values.put_wall,590.125);
  assert.equal(view.values.net_premium,0);
  assert.equal(view.values.gamma_flip,595.5);
  assert.equal(view.values.market_tide,'Calls $1M · Puts −$250K');
  assert.equal(view.fields.market_tide.scope,'market-wide');
  assert.equal(view.fields.net_premium.scope,'SPY');
  assert.equal(view.display_only,true);
});

test('a placeholder and missing source/time never become live data', () => {
  assert.equal(normalizeUW({...base(),status:'placeholder'}, {now:NOW}).state,'UNAVAILABLE');
  assert.equal(normalizeUW({...base(),asof:null}, {now:NOW}).values.call_wall,null);
  assert.equal(normalizeUW({...base(),source:null}, {now:NOW}).state,'UNAVAILABLE');
  assert.equal(normalizeUW(null, {now:NOW}).values.net_premium,null);
});

test('selecting SPX never reuses or scales SPY gamma or premium; global tide remains separate', () => {
  const view = normalizeUW(base(), {symbol:'SPX',now:NOW});
  assert.equal(view.state,'PARTIAL');
  assert.equal(view.values.call_wall,null);
  assert.equal(view.values.net_premium,null);
  assert.equal(view.values.max_pain,null);
  assert.match(view.values.market_tide,/Calls/);
});

test('by_symbol accepts only the selected non-conflicting instrument', () => {
  const wrapper = {source:'Unusual Whales',asof:base().asof,status:'live',by_symbol:{SPX:{gamma:{call_wall:'6050.25',put_wall:5900,zero_gamma:6000},flow:{net_premium:'-123.5'},max_pain:{spot:6000}}}};
  const view = normalizeUW(wrapper,{symbol:'SPX',now:NOW});
  assert.equal(view.values.call_wall,6050.25);
  assert.equal(view.values.net_premium,-123.5);
  assert.equal(view.values.max_pain,6000);
  assert.equal(view.values.market_tide,null);
  wrapper.by_symbol.SPX.symbol='SPY';
  assert.equal(normalizeUW(wrapper,{symbol:'SPX',now:NOW}).values.call_wall,null);
});

test('fresh and stale fields keep their own provenance rather than a shared live badge', () => {
  const raw=base(); raw.gamma.asof='2026-10-23T13:00:00Z'; raw.flow.net_premium={value:123,asof:'2026-10-23T13:58:00Z'};
  const view=normalizeUW(raw,{now:NOW});
  assert.equal(view.state,'PARTIAL');
  assert.equal(view.fields.call_wall.state,'STALE');
  assert.equal(view.fields.call_wall.value,600.25);
  assert.equal(view.fields.net_premium.state,'CURRENT');
  assert.equal(view.fields.net_premium.asof,'2026-10-23T13:58:00Z');
  assert.equal(view.asof,'2026-10-23T13:00:00Z');
});

test('field timestamps and explicit instrument identity override enclosing metadata', () => {
  const raw=base();raw.gamma.call_wall={value:600,timestamp:'2026-10-23T13:00:00Z'};
  raw.gamma.put_wall={value:5900,symbol:'SPX'};
  const view=normalizeUW(raw,{now:NOW});
  assert.equal(view.fields.call_wall.state,'STALE');
  assert.equal(view.fields.call_wall.asof,'2026-10-23T13:00:00Z');
  assert.equal(view.fields.put_wall.value,null);
});

test('failed refresh preserves dated values as stale and future timestamps fail closed', () => {
  assert.equal(normalizeUW({...base(),status:'error'},{now:NOW}).state,'STALE');
  const future=normalizeUW({...base(),asof:'2026-10-23T14:05:00Z'},{now:NOW});
  assert.equal(future.state,'UNAVAILABLE');
  assert.equal(future.values.call_wall,null);
  const old=normalizeUW(base(),{now:Date.parse('2026-10-24T14:00:00Z')});
  assert.equal(old.state,'STALE');
});

test('ETF tide cannot be labeled market-wide and absent/invalid values remain absent', () => {
  const raw=base();raw.market_tide={symbol:'SPY',summary:'Bullish'};raw.gamma.call_wall='';raw.gamma.put_wall=0;raw.gamma.zero_gamma=Infinity;
  const view=normalizeUW(raw,{now:NOW});
  assert.equal(view.values.market_tide,null);
  assert.equal(view.values.call_wall,null);
  assert.equal(view.values.put_wall,null);
  assert.equal(view.values.gamma_flip,null);
  assert.equal(view.values.net_premium,0);
});

test('unbounded provider TTL cannot make a previous session look current', () => {
  const view=normalizeUW({...base(),ttl_minutes:999999},{now:NOW+2*3600000});
  assert.equal(view.state,'STALE');
});

const EOD=Date.parse('2026-10-23T19:55:00Z');
function leanFixture(now=EOD) {
  return {raw:{symbol:'SPY',source:'Unusual Whales',asof:new Date(now-60000).toISOString(),status:'live',
    flow:{net_premium:125000,classification:'bullish'},max_pain:600.25},
    options:{now,snapshot:{market:{symbol:'SPY',last:599},health:{state:'CURRENT',price_asof:new Date(now-60000).toISOString()},
      session:{date:'2026-10-23',calendar_date:'2026-10-23',status:'OPEN',open:'2026-10-23T13:30:00Z',close:'2026-10-23T20:00:00Z'}}}};
}
function visible(change,now=EOD){const x=leanFixture(now);change?.(x);return maxPainLean(x.raw,x.options).visible;}

test('last-ten-minute line shows precise SPY target only with explicit agreeing premium',()=>{
  const {raw,options}=leanFixture(),before=structuredClone({raw,options}),view=maxPainLean(raw,options);
  assert.equal(view.visible,true);assert.equal(view.target,600.25);assert.equal(view.direction,1);assert.equal(view.display_only,true);
  assert.equal(view.text,'Last-10-min max-pain lean: toward $600.25, net premium agrees, ~60% historically (n=128)');
  assert.match(view.evidence,/Carter-reported/);assert.match(view.evidence,/not independently reproduced or a live win probability/);
  assert.deepEqual({raw,options},before);
  assert.equal(visible(x=>{x.raw.max_pain=598;x.raw.flow.classification='bearish';x.raw.flow.net_premium=-25000;}),true);
});
test('last-ten-minute interval includes its start and excludes the close',()=>{
  assert.equal(visible(null,Date.parse('2026-10-23T19:49:59.999Z')),false);
  assert.equal(visible(null,Date.parse('2026-10-23T19:50:00Z')),true);
  assert.equal(visible(null,Date.parse('2026-10-23T19:59:59.999Z')),true);
  assert.equal(visible(null,Date.parse('2026-10-23T20:00:00Z')),false);
});
test('actual exchange close controls early-close timing',()=>{
  const early=x=>Object.assign(x.options.snapshot.session,{date:'2026-11-27',calendar_date:'2026-11-27',open:'2026-11-27T14:30:00Z',close:'2026-11-27T18:00:00Z'});
  assert.equal(visible(early,Date.parse('2026-11-27T17:50:00Z')),true);
  assert.equal(visible(early,Date.parse('2026-11-27T17:49:59Z')),false);
  assert.equal(visible(early,Date.parse('2026-11-27T18:00:00Z')),false);
});
test('closed, unknown, stale-session and weekend data do not produce the lean',()=>{
  for(const change of [x=>x.options.snapshot.session.status='CLOSED',x=>delete x.options.snapshot.session.close,x=>delete x.options.snapshot.session.calendar_date,
    x=>x.options.snapshot.session.date='2026-10-22',x=>x.options.snapshot.session.close=x.options.snapshot.session.open,
    x=>x.options.now=NaN])assert.equal(visible(change),false);
  assert.equal(visible(x=>Object.assign(x.options.snapshot.session,{date:'2026-10-24',calendar_date:'2026-10-24',open:'2026-10-24T13:30:00Z',close:'2026-10-24T20:00:00Z'}),Date.parse('2026-10-24T19:55:00Z')),false);
});
test('other ticker selections, conflicting feed identity and market-wide tide cannot substitute for SPY',()=>{
  for(const change of [x=>x.options.symbol='SPX',x=>x.options.snapshot.market.symbol='SPX',x=>x.raw.symbol='AAPL',
    x=>{delete x.raw.flow;x.raw.market_tide={summary:'Bullish',net_call_premium:1000000,net_put_premium:-500000};},
    x=>x.raw.max_pain={value:600.25,symbol:'SPX'},x=>x.raw.flow.net_premium={value:125000,symbol:'GOOGL'},
    x=>x.raw.flow.classification={value:'bullish',symbol:'SPX'}])assert.equal(visible(change),false);
  assert.equal(visible(x=>{const row=x.raw;x.raw={source:row.source,asof:row.asof,status:row.status,by_symbol:{SPY:{flow:row.flow,max_pain:row.max_pain}}};}),true);
});
test('freshness is per used field, has a five-minute ceiling and rejects any future timestamp',()=>{
  assert.equal(visible(x=>x.raw.asof=new Date(EOD-300000).toISOString()),true);
  for(const change of [x=>x.raw.asof=new Date(EOD-300001).toISOString(),x=>x.raw.asof=new Date(EOD+1).toISOString(),
    x=>x.raw.max_pain={value:600.25,asof:new Date(EOD-300001).toISOString()},
    x=>x.raw.flow.classification={value:'bullish',asof:new Date(EOD-300001).toISOString()},
    x=>x.raw.flow.net_premium={value:125000,asof:new Date(EOD+1).toISOString()},
    x=>x.raw.asof='2026-10-22T19:54:00Z'])assert.equal(visible(change),false);
  assert.equal(visible(x=>{x.raw.gamma={asof:'2026-10-22T19:54:00Z',call_wall:700};}),true,'unused stale gamma does not invalidate fresh agreeing inputs');
});
test('price freshness stays at the confirmed-bar limit and failed updates hide retained agreement',()=>{
  assert.equal(visible(x=>x.options.snapshot.health.price_asof=new Date(EOD-225000).toISOString()),true);
  for(const change of [x=>x.options.failed=true,x=>x.options.snapshot.health.state='STALE',
    x=>x.options.snapshot.health.price_asof=new Date(EOD-225001).toISOString(),
    x=>x.options.snapshot.health.price_asof=new Date(EOD+1).toISOString(),x=>x.raw.status='error',
    x=>x.raw.status='placeholder',x=>delete x.raw.source,x=>delete x.raw.asof])assert.equal(visible(change),false);
});
test('neutral, zero, missing, ambiguous and disagreeing inputs stay hidden',()=>{
  for(const change of [x=>x.raw.flow.classification='bearish',x=>x.raw.flow.classification='neutral',x=>delete x.raw.flow.classification,
    x=>x.raw.flow.net_premium=0,x=>x.raw.flow.net_premium=null,x=>x.raw.max_pain=599,x=>x.raw.max_pain=0,
    x=>x.options.snapshot.market.last=null,x=>x.options.snapshot.market.last=0,
    x=>{delete x.raw.flow.classification;x.raw.flow.call_premium=200000;x.raw.flow.put_premium=75000;}])assert.equal(visible(change),false);
});
test('declared signed call-minus-put premium supports direction without gross-flow inference',()=>{
  const pair=x=>{delete x.raw.flow.classification;Object.assign(x.raw.flow,{net_call_premium:100000,net_put_premium:-25000,net_premium_basis:'net_call_minus_net_put'});};
  assert.equal(visible(pair),true);
  assert.equal(visible(x=>{pair(x);delete x.raw.flow.net_premium_basis;}),false);
  assert.equal(visible(x=>{pair(x);x.raw.flow.net_premium=125001;}),false);
  assert.equal(visible(x=>{pair(x);x.raw.flow.classification='bearish';}),false);
  assert.equal(visible(x=>{pair(x);x.raw.flow.net_put_premium={value:-25000,asof:new Date(EOD-300001).toISOString()};}),false);
  assert.equal(visible(x=>{pair(x);x.raw.max_pain=598;Object.assign(x.raw.flow,{net_call_premium:-100000,net_put_premium:25000,net_premium:-125000});}),true);
});
