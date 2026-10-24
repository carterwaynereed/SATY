import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {minuteSeries} from '../lib/saty-live.mjs';
import {aggregateTenMinutes} from '../lib/tradingview-feed.mjs';
import {decisionRows} from '../lib/research-ledger.mjs';
import {recordResearch} from '../scripts/record_research.mjs';
import {analyzeEOD,closeWindow} from '../site/eod-analysis.mjs';
import {prepareSync} from '../site/public-sync.mjs';
import {DEFAULT_RULE,scoreEpisode,wilson,summarizeEpisodes,evaluateCandidate,replayPolicy,promotionStatus,ruleHash} from '../lib/shadow-replay.mjs';
import {fixture} from './research-fixtures.mjs';
const now=Date.parse('2026-10-23T19:45:10Z');
test('confirmed 1m bars for every ticker, no forming candle and explicit missing hold',()=>{
 for(const symbol of ['SPY','SPX','AAPL','GOOGL']){
  const f=fixture();f.symbol=symbol;const result=minuteSeries(f,f.session,now);
  assert.equal(result.health.state,'CURRENT');assert.equal(result.bars.length,120);
  assert.ok(result.bars.every(b=>Date.parse(b.time)+60000<=now));
  assert.equal(result.health.price_asof,'2026-10-23T19:45:00.000Z');
  assert.equal(minuteSeries({...f,one_bars:[]},f.session,now).health.state,'UNAVAILABLE');
 }
});
test('1m holes and delays hold without synthesizing bars from 3m',()=>{
 const f=fixture();f.one_bars=f.one_bars.filter(b=>b.time!=='2026-10-23T19:40:00.000Z');
 assert.equal(minuteSeries(f,f.session,now).health.state,'GAP');
 assert.equal(minuteSeries({...f,one_bars:fixture().one_bars.filter(b=>b.time<'2026-10-23T19:42:00Z')},f.session,now).health.state,'STALE');
});
test('EOD detector distinguishes missing, stale, completed reference, and calendar close',()=>{
 const f=fixture(),session={...f.session,daily_atr:2};
 assert.equal(analyzeEOD([],1,session,now).state,'DATA_HOLD');
 assert.equal(analyzeEOD(f.one_bars,1,session,now).state,'CURRENT');
 assert.equal(analyzeEOD(f.one_bars.filter(b=>b.time<'2026-10-23T19:40:00Z'),1,session,now).state,'DATA_HOLD');
 assert.equal(analyzeEOD(f.one_bars,1,session,Date.parse('2026-10-23T20:01:00Z')).state,'REFERENCE');
 assert.equal(closeWindow(session,Date.parse('2026-10-23T19:50:00Z')).state,'LAST_10_MINUTES');
 assert.equal(closeWindow({...session,close:'2026-10-23T17:00:00Z'},Date.parse('2026-10-23T16:50:00Z')).state,'LAST_10_MINUTES');
});
test('per-bar ledger is prefix causal, distinguishes observed/late, and does not reuse final weights',()=>{
 const f=fixture();f.trend_bars=aggregateTenMinutes(f.one_bars,Date.parse(f.session.close));
 const full=decisionRows(f,f.session,Date.parse('2026-10-23T20:00:10Z'));
 const cutoff=Date.parse('2026-10-23T15:30:10Z');const prefix=decisionRows(f,f.session,cutoff);
 const byTime=new Map(full.map(r=>[r.time,r]));
 assert.equal(full.length,130);assert.equal(prefix.length,40);
 for(const r of prefix){const long=byTime.get(r.time);assert.equal(r.decision,long.decision);assert.deepEqual(r.evidence_score,long.evidence_score);assert.deepEqual(r.row_directions,long.row_directions);}
 assert.equal(prefix.at(-1).observation_kind,'OBSERVED');assert.equal(prefix[0].observation_kind,'REPLAY_LATE');
 assert.ok(new Set(full.map(x=>JSON.stringify(x.evidence_score))).size>1);
 assert.ok(full.every(r=>Object.values(r.evidence_score).reduce((a,b)=>a+b,0)===100));
});
test('ledger append is idempotent; first-observed rows survive later provider revisions',async()=>{
 const state=await mkdtemp(join(tmpdir(),'saty-ledger-'));try{
 const f=fixture();f.trend_bars=[];const s={session:f.session,health:{state:'CURRENT',source:f.source,price_asof:'2026-10-23T19:45:00Z'}};
 await recordResearch({SPY:f},{SPY:s},state,now);
 const path=join(state,'decisions','2026-10-23.jsonl'),before=await readFile(path,'utf8');
 await recordResearch({SPY:f},{SPY:s},state,now+10000);assert.equal(await readFile(path,'utf8'),before);
 f.bars.at(-6).close+=.02;await recordResearch({SPY:f},{SPY:s},state,now+20000);assert.equal(await readFile(path,'utf8'),before);
 }finally{await rm(state,{recursive:true,force:true});}
});
test('public sync never prepares transmission without opt-in or with credentials',()=>{
 const base={symbol:'SPY',leaderboard:JSON.stringify({asof:'2026-10-23T19:50:00Z',method:'Manual UW',expiry_scope:'0DTE',contracts:[]}),lessons:[]};
 assert.throws(()=>prepareSync({...base,confirmed:false}),/Confirm/);
 const r=prepareSync({...base,confirmed:true});assert.equal(r.payload.public_safe,true);assert.match(r.url,/github.com\/carterwaynereed\/SATY\/issues\/new/);
 assert.throws(()=>prepareSync({...base,confirmed:true,lessons:[{url:'https://example.com',text:'api_key=private',date:'2026-10-23T20:00:00Z'}]}),/credential/);
});
test('shadow barriers resolve actual alternate calls, ties, gaps, timeout and missing horizons',()=>{
 const bars=Array.from({length:7},(_,i)=>({time:new Date(Date.parse('2026-10-23T15:00:00Z')+i*180000).toISOString(),open:100,high:100.1,low:99.9,close:100}));
 const r={...DEFAULT_RULE,risk_atr:.1},close=Date.parse('2026-10-23T20:00:00Z');
 bars[2].high=101;assert.equal(scoreEpisode(bars,0,1,r,2,close).outcome,'TARGET_FIRST');
 bars[2].low=99;const tie=scoreEpisode(bars,0,1,r,2,close);assert.equal(tie.outcome,'STOP_FIRST');assert.equal(tie.ambiguous,true);
 bars[2].open=101;assert.equal(scoreEpisode(bars,0,1,r,2,close).outcome,'TARGET_FIRST');
 assert.equal(scoreEpisode(bars.slice(0,2),0,1,r,2,close).outcome,'UNKNOWN');
 bars[2]={...bars[1],time:bars[2].time};assert.equal(scoreEpisode(bars,0,1,r,2,close).outcome,'TIMEOUT');
});
test('shadow rules execute on bars and never count pre-registration data',()=>{
 const f=fixture(),candidate={candidate_id:'TEST-CANDIDATE',registered_at:'2026-10-22T21:00:00Z',rule_set:{...DEFAULT_RULE,confirmation:'none'}};
 const result=evaluateCandidate(candidate,f);assert.equal(result.status,'EVALUATED');assert.ok(result.shadow.episodes.length>0);
 assert.ok(result.shadow.episodes.every(x=>x.shadow_only&&x.probability===null));assert.ok(result.shadow.summary.n>0);
 assert.equal(evaluateCandidate({...candidate,registered_at:'2026-10-23T14:00:00Z'},f).status,'NOT_YET_ELIGIBLE');
 assert.equal(evaluateCandidate(candidate,{...f,bars:f.bars.slice(0,-1)}).status,'DATA_HOLD');
 const before=JSON.stringify(f);replayPolicy(f,{...DEFAULT_RULE,confirmation:'strict'});assert.equal(JSON.stringify(f),before);
 assert.notEqual(ruleHash(candidate.rule_set),ruleHash(DEFAULT_RULE));
});
test('Wilson uses actual event denominator; thresholds alone cannot promote',()=>{
 const [lo,hi]=wilson(25,43);assert.ok(lo<25/43&&hi>25/43);assert.equal(wilson(0,0),null);
 const s=summarizeEpisodes([{outcome:'TARGET_FIRST',realized_r:1,risk:1},{outcome:'UNKNOWN'},{outcome:'STOP_FIRST',realized_r:-1,risk:1}]);
 assert.equal(s.n,2);assert.equal(s.hits,1);assert.equal(s.unresolved_n,1);assert.deepEqual(s.wilson_95,wilson(1,2));
 assert.equal(promotionStatus(29,100).sample_floor_met,false);assert.equal(promotionStatus(30,99).sample_floor_met,false);
 assert.equal(promotionStatus(30,100).sample_floor_met,true);assert.equal(promotionStatus(30,100).eligible_for_promotion,false);
});
