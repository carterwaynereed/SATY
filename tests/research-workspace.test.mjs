import test from 'node:test';
import assert from 'node:assert/strict';
import {researchSnapshot,referenceExitModel,momentumChartModel,renderExitPanel} from '../site/exit-panel.mjs';
import {renderLiveAlerts} from '../site/live-alert-panel.mjs';
import {renderBouncePanel} from '../site/level-bounce-panel.mjs';
import {chartLevels} from '../site/chart-overlays.mjs';

const now=Date.parse('2026-10-26T14:06:10Z');
const trade={id:'reference-call',side:1,entry:600,stop:596.5,target:{price:604,label:'0.4 ATR'},entry_at:'2026-10-26T14:00:00Z',decision_at:'2026-10-26T14:00:00Z',status:'TRACKING'};
function fixture(){return {
 market:{symbol:'SPY',last:601,atr14:10,vwap:600,day_high:602,day_low:599},
 session:{date:'2026-10-26',open:'2026-10-26T13:30:00Z',close:'2026-10-26T20:00:00Z'},
 health:{state:'CURRENT',price_asof:'2026-10-26T14:06:00Z'},
 levels:[{label:'+23.6',price:600,multiple:.236},{label:'+38.2',price:602,multiple:.382},{label:'+50',price:603,multiple:.5},{label:'+61.8',price:604,multiple:.618}],
 bars:[{time:'2026-10-26T14:00:00Z',open:600,low:599.9,high:601,close:600.5},{time:'2026-10-26T14:03:00Z',open:600.5,low:600,high:601.5,close:601}],
 reference_models:{approved_rules:{trades:[{...trade,id:'score-model'}],entries_today:1},level_bounce:{trades:[structuredClone(trade)],position:structuredClone(trade),entries_today:1},live_alerts:{trades:[{...trade,id:'box-replay',setup_id:'BOX_BREAK',setup:'Call Trigger Break from Box'}],global_total:5,ticker_total:3}}
};}
function root(){const select={};return {innerHTML:'',querySelector:selector=>selector==='select'?select:null,querySelectorAll:()=>[],select};}

test('reference adapters read nested replay models without changing live snapshot or issuing another signal',()=>{
 const s=fixture(),before=structuredClone(s),clone=researchSnapshot(s);
 assert.equal(clone.approved_rules.trades[0].id,'score-model');assert.equal(clone.research_only,true);
 const x=referenceExitModel(s,{now,selectedId:'reference-call'});
 assert.equal(x.status,'REFERENCE');assert.equal(x.tone,'neutral');assert.equal(x.setup.id,'reference-call');assert.equal(x.stop.price,596.5);
 assert.match(x.policy_note,/research only/);assert.doesNotMatch(x.policy_note,/5 today|Trades today|new entries/);
 assert.doesNotMatch(x.action,/trim|take profit|trail stop|WAIT for/);assert.doesNotMatch(x.stats,/Forward-testing from/);
 assert.deepEqual(s,before);assert.equal(s.health.state,'CURRENT');
});
test('selected archived score, bounce and box-break records remain selectable',()=>{
 const s=fixture();
 for(const id of ['score-model','reference-call','box-replay']){
  const x=referenceExitModel(s,{now,selectedId:id});assert.equal(x.setup.id,id);assert.equal(x.status,'REFERENCE');assert.equal(x.reference,true);
 }
 const element=root();let chosen;
 renderExitPanel(element,s,{now,referenceOnly:true,selectedId:'box-replay',onSelect:id=>chosen=id});
 assert.match(element.innerHTML,/Targets &amp; exit context|Targets & exit context/);assert.match(element.innerHTML,/research only/);assert.doesNotMatch(element.innerHTML,/All live alerts|market closed/i);
 element.select.onchange({target:{value:'reference-call'}});assert.equal(chosen,'reference-call');
});
test('retired setup panels show corrected research evidence without reviving live admission rules',()=>{
 const s=fixture(),bounce=root(),alerts=root();
 renderBouncePanel(bounce,s,{now,referenceOnly:true});renderLiveAlerts(alerts,s,{now,referenceOnly:true});
 assert.match(bounce.innerHTML,/RESEARCH ONLY/);assert.match(bounce.innerHTML,/Closed green %: 47%/);assert.match(bounce.innerHTML,/PF: 0.92/);assert.match(bounce.innerHTML,/n not supplied/);assert.doesNotMatch(bounce.innerHTML,/70%|>CALL<|Trades today/);
 assert.match(alerts.innerHTML,/REFERENCE ONLY/);assert.match(alerts.innerHTML,/Call Trigger Break from Box/);assert.match(alerts.innerHTML,/Target hit %/);assert.match(alerts.innerHTML,/Closed green %/);assert.match(alerts.innerHTML,/n=22/);
 assert.doesNotMatch(alerts.innerHTML,/Best live alerts|5 today|Aim for|NEXT OPEN|CALL · HOLD/);
});
test('Momentum overlays match the selected ticker and session and keep archived overlays separate',()=>{
 const s=fixture(),momentum={session_date:s.session.date,state:'HOLD',signal:{symbol:'SPY',side:1,entry:601,stop:598,target:{price:603.36},next_level:{price:604,label:'+61.8'},live:true,read_only:false}};
 const before=structuredClone(momentum),x=momentumChartModel(momentum,s),levels=chartLevels(s,x);
 assert.equal(x.reference,false);assert.deepEqual(levels.map(l=>[l.exitRole,l.price]),[['target',603.36],['target',604],['stop',598]]);
 assert.equal(momentumChartModel(momentum,{...s,market:{...s.market,symbol:'SPX'}}),null);
 assert.equal(momentumChartModel({...momentum,session_date:'2026-10-23'},s),null);
 assert.equal(momentumChartModel({...momentum,signal:{...momentum.signal,read_only:true}},s).reference,true);
 const replay=referenceExitModel(s,{now,selectedId:'reference-call'});assert.equal(chartLevels(s,replay).at(-1).price,596.5);
 assert.deepEqual(momentum,before);
});
