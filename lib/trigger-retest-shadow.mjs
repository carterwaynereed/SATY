import {outcomeStats} from '../site/outcome-stats.mjs';
import {replayApproved,summarizeApproved} from './setup-shadow-engine.mjs';
export const RETEST_VERSION='trigger-retest-1.0';
export const SUITE_VERSION='shadow-trigger-retest-suite-1.0';
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
  return {...shared,version:id==='TRIGGER_RETEST'?RETEST_VERSION:shared.version,shadow_only:true,eligible_for_execution:false,setup_id:id,trades,position:combined.position?.setup_id===id?combined.position:null,pending:combined.pending?.setup_id===id?combined.pending:null,entries_for_setup:trades.length,shared_risk:true,runner_enabled:id==='TRIGGER_RETEST'?retestRunner:true};
 };
 for(const t of combined.trades){t.shadow_only=true;t.eligible_for_execution=false;t.probability=null;}
 return {version:SUITE_VERSION,shadow_only:true,eligible_for_execution:false,retest_runner:retestRunner,combined,main:project('MAIN'),retest:project('TRIGGER_RETEST')};
}
export function retestStats(trades){
 const summary=summarizeApproved(trades),n=summary.n,hits=summary.wins;
 let ci=null;if(n){const z=1.959963984540054,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;ci=[Math.max(0,c-h),Math.min(1,c+h)];}
 return {...summary,...outcomeStats(trades),hits,wilson_95:ci,rate:n>=20?hits/n:null,evidence:'PROSPECTIVE_REPLAY',note:'Legacy rate means closed green, never target hit. Use explicit target_hit_rate and closed_green_rate. Wilson is descriptive; sessions may be correlated. No costs or options payoff.'};
}
