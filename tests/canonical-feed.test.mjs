import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalFeed} from '../lib/canonical-feed.mjs';
import {buildLiveSnapshot} from '../lib/saty-live.mjs';
import {fixture} from './research-fixtures.mjs';
import {decisionRows} from '../lib/research-ledger.mjs';

test('Python UTC-offset capture produces the same four-ticker snapshot and ledger as hosted ISO timestamps',()=>{
  const now=Date.parse('2026-10-23T20:01:00Z');
  for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
    const feed=fixture();feed.symbol=symbol;
    feed.daily.push({time:'2026-10-22T13:30:00.000Z',open:100,high:101,low:99,close:100,volume:100});
    const calendar={sessions:Object.fromEntries(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23'].map(day=>[day,{open:day+'T13:30:00.000Z',close:day+'T20:00:00.000Z'}]))};
    const python=structuredClone(feed);
    for(const key of ['bars','one_bars','daily'])for(const bar of python[key])bar.time=bar.time.replace('.000Z','+00:00');
    assert.throws(()=>buildLiveSnapshot(python,null,calendar,now),/Opening 3m bar missing/);
    const normalized=canonicalFeed(python);
    const expected=buildLiveSnapshot(feed,null,calendar,now),actual=buildLiveSnapshot(normalized,null,calendar,now);
    assert.deepEqual(actual,expected);assert.equal(actual.one_minute_bars.length,120);
    assert.equal(actual.one_minute_health.state,'CLOSED');
    assert.deepEqual(decisionRows(normalized,feed.session,now),decisionRows(feed,feed.session,now));
    assert.ok(python.bars[0].time.endsWith('+00:00'),'capture input is never mutated');
  }
});
test('invalid capture timestamp is rejected rather than normalized into invented data',()=>{
  assert.throws(()=>canonicalFeed({bars:[{time:'invalid'}]}),/Invalid timestamp/);
});
