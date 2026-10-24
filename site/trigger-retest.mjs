import {replayApproved,summarizeApproved} from './approved-rules.mjs';
export const RETEST_VERSION='trigger-retest-1.0';
export const SUITE_VERSION='saty-dual-setups-1.0';
export function retestCandidate(rows,index,levels){
 const r=rows[index],atr=r?.atr14;
 if(!(atr>0)||r.et_close<'10:00'||r.et_close>='15:00')return null;
 for(const side of [1,-1]){
  const trigger=levels.find(l=>l.label===(side===1?'+23.6':'-23.6'))?.price;
  if(!Number.isFinite(trigger)||r.row_directions?.[0]!==side||!Number.isFinite(r.phase)||side*r.phase>=60)continue;
  // Strictly earlier today; current candle cannot establish its own excursion.
  const earlier=rows.slice(0,index).some(p=>p.session_date===r.session_date&&side*(p.close-trigger)>.1*atr);
  const extreme=side===1?r.low:r.high;
  if(earlier&&Math.abs(extreme-trigger)<=.03*atr+1e-10&&side*(r.close-trigger)>0)return {setup_id:'TRIGGER_RETEST',side,trigger,time:r.time,entry_time:r.time};
 }
 return null;
}
export function replayDual(rows,levels,session,{now=Date.now(),minutes=[],retestRunner=false}={}){
 const combined=replayApproved(rows,levels,session,{now,minutes,secondary:{detect:retestCandidate,runner:retestRunner,suite_version:SUITE_VERSION}});
 const project=id=>{
  const {decisions,...shared}=combined,trades=combined.trades.filter(t=>(t.setup_id??'MAIN')===id);
  return {...shared,version:id==='TRIGGER_RETEST'?RETEST_VERSION:shared.version,setup_id:id,trades,position:combined.position?.setup_id===id?combined.position:null,pending:combined.pending?.setup_id===id?combined.pending:null,entries_for_setup:trades.length,shared_risk:true,runner_enabled:id==='TRIGGER_RETEST'?retestRunner:true};
 };
 return {version:SUITE_VERSION,retest_runner:retestRunner,combined,main:project('MAIN'),retest:project('TRIGGER_RETEST')};
}
export function selectSetupScenario(snapshot,runner=false){
 if(!snapshot?.setup_suite)return snapshot;
 const variant=runner?snapshot.setup_suite.runner:snapshot.setup_suite.fixed;
 return {...snapshot,approved_rules:variant.main,trigger_retest:variant.retest};
}
export function retestStats(trades){
 const summary=summarizeApproved(trades),n=summary.n,hits=summary.wins;
 let ci=null;if(n){const z=1.959963984540054,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;ci=[Math.max(0,c-h),Math.min(1,c+h)];}
 return {...summary,hits,wilson_95:ci,rate:n>=20?hits/n:null,evidence:'PROSPECTIVE_REPLAY',note:'Win means positive underlying modeled return; flat is not a win. Wilson is descriptive; sessions may be correlated. No costs or options payoff.'};
}
export function renderRetest(root,snapshot,{runner=false,onRunner,stats=null,reported=null,failed=false,now=Date.now()}={}){
 const p=snapshot?.trigger_retest,symbol=snapshot?.market?.symbol??'',fresh=!failed&&snapshot?.health?.state==='CURRENT'&&now-Date.parse(snapshot.health.price_asof)>=0&&now-Date.parse(snapshot.health.price_asof)<=225000;
 const last=p?.position??p?.trades?.at(-1),candidate=p?.pending;
 const status=!p?'DATA HOLD':!fresh?'REFERENCE':p.position?.time_exit_pending?'DATA HOLD':p.position?.runner?'RUNNER':p.position?'HOLD':candidate?'NEXT OPEN':last?.status==='CLOSED'?'EXIT · '+last.exit_reason:'WAIT';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const price=x=>Number.isFinite(x)?x.toFixed(2):'—',count=stats?.n??0;
 const live=count>=20&&Number.isFinite(stats?.rate)&&Array.isArray(stats?.wilson_95)?`${Math.round(stats.rate*100)}% wins · n=${count} · Wilson 95% ${stats.wilson_95.map(x=>Math.round(x*100)+'%').join('–')}`:`Live observed sample n=${count} · ${count?'rate withheld until n≥20':'Wilson CI unavailable (no resolved sample)'}`;
 root.innerHTML=`<div class="panel-head"><div><h2>TRIGGER RETEST · ${esc(symbol)}</h2><span class="tag">High-probability, small target</span></div><span class="exit-badge ${fresh?'amber':'neutral'}">${esc(status)}</span></div><p class="fine">Separate setup outcomes · shared ticker cap and 30-minute loss/flat cooldown · no entries after 3 PM. Main setup has priority on simultaneous candidates.</p><label class="overlay-toggle"><input type="checkbox" aria-label="Optional retest runner" ${runner?'checked':''}> Optional runner scenario (one extra leg)</label><p>${last?`${last.side===1?'CALL':'PUT'} · modeled entry $${price(last.entry)} · stop $${price(last.stop)} · target $${price(last.target?.price)} · ${esc(last.status)}`:candidate?`${candidate.side===1?'CALL':'PUT'} confirmed; waits for next available 3m open.`:'WAIT for an earlier excursion and a confirmed trigger retest.'}</p><p class="fine">${p?`Trades today ${p.entries_for_setup} in this setup; ${p.entries_today} across both setups. `:''}Stop 0.20 daily ATR · target 0.08 ATR · no ribbon exit or breakeven · 15:55 time exit. ${last?.runner?'RUNNER: trail to touched target '+(last.side===1?'−':'+')+' 0.05 ATR; one more equal leg.':''}</p><p><b>${esc(live)}</b>${count>0&&count<20&&stats?.wilson_95?' · Wilson 95% '+stats.wilson_95.map(x=>Math.round(x*100)+'%').join('–'):''}</p><p class="fine">Reported walk-forward: 84% wins, Wilson 74–91%, n=64, +1.49%, PF 1.43, five unseen weeks (user-supplied; not independently reproduced). ${reported?.runner_mode??'Runner treatment and individual outcomes were not supplied.'} The label describes that reported study, not a calibrated live probability.</p>`;
 root.querySelector('input').onchange=e=>onRunner?.(e.target.checked);
}
