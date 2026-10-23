import test from 'node:test';
import assert from 'node:assert/strict';
import {EVIDENCE_ROWS,allocateEvidenceWeights} from '../site/weights.mjs';
const rows = directions => EVIDENCE_ROWS.map((row,i) => ({...row,direction:directions[i]}));
const live = {fresh:true,inSession:true};
const allocation = result => [result.call,result.put,result.wait];

test('all bullish: 25+25+10+15+10+15 produces 100/0/0', () => {
  const value=allocateEvidenceWeights(rows([1,1,1,1,1,1]),live);
  assert.deepEqual(allocation(value),[100,0,0]);
  assert.equal(value.bull,100);assert.equal(value.conflict,0);
});
test('all bearish: six bearish rows produce 0/100/0', () => {
  assert.deepEqual(allocation(allocateEvidenceWeights(rows([-1,-1,-1,-1,-1,-1]),live)),[0,100,0]);
});
test('mixed: bullish 60, bearish 25, neutral 15 gives 35/0/65', () => {
  const value=allocateEvidenceWeights(rows([1,-1,1,1,1,0]),live);
  assert.deepEqual(allocation(value),[35,0,65]);
  assert.equal(value.bull,60);assert.equal(value.bear,25);assert.equal(value.neutral,15);assert.equal(value.conflict,25);
  assert.match(value.math,/WAIT = 15 \+ 2 × 25 = 65%/);
});
test('stale all-bullish: reference rows persist but live allocation is 0/0/100', () => {
  const value=allocateEvidenceWeights(rows([1,1,1,1,1,1]),{fresh:false,inSession:true});
  assert.deepEqual(allocation(value),[0,0,100]);assert.equal(value.bull,100);assert.equal(value.blocked,true);
});
test('midday entry pause and missing trigger do not override fresh RTH row math', () => {
  const value=allocateEvidenceWeights(rows([1,1,1,1,1,0]),live);
  assert.deepEqual(allocation(value),[85,0,15]);
});
test('closed session and absent indicators stay neutral', () => {
  assert.deepEqual(allocation(allocateEvidenceWeights(rows([1,1,1,1,1,1]),{fresh:true,inSession:false})),[0,0,100]);
  const closed=allocateEvidenceWeights(rows([1,1,1,1,1,1]),{fresh:false,inSession:false});
  assert.deepEqual(allocation(closed),[0,0,100]);assert.match(closed.reason,/Outside the regular session/);
  assert.deepEqual(allocation(allocateEvidenceWeights([],live)),[0,0,100]);
});
test('every possible combination totals 100 points without negative percentages', () => {
  for(let code=0;code<729;code++){
    let n=code;const directions=EVIDENCE_ROWS.map(()=>{const v=n%3-1;n=Math.floor(n/3);return v;});
    const value=allocateEvidenceWeights(rows(directions),live);
    assert.equal(value.call+value.put+value.wait,100);
    assert.ok(allocation(value).every(x=>x>=0&&x<=100));
  }
});
