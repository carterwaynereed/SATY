import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUW} from '../site/uw-view.mjs';

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
