// Target success and positive closing return are different events.
const finite=Number.isFinite;
export function outcomeStats(trades){
 const closed=(trades??[]).filter(t=>['CLOSED','closed'].includes(t.status)&&finite(t.return_pct??t.r)),n=closed.length;
 const target=t=>t.target_hit===true||t.extensions?.length>0||['TARGET','ATR target','Target'].includes(t.exit_reason??t.reason);
 const targetKnown=closed.filter(t=>typeof t.target_hit==='boolean'||Array.isArray(t.extensions)||typeof (t.exit_reason??t.reason)==='string'),target_hits=targetKnown.filter(target).length,green=closed.filter(t=>(t.return_pct??t.r)>0).length,gain=closed.reduce((s,t)=>s+Math.max(0,t.return_pct??t.r),0),loss=-closed.reduce((s,t)=>s+Math.min(0,t.return_pct??t.r),0);
 return {n,target_hits,closed_green:green,target_known_n:targetKnown.length,target_hit_rate:n&&targetKnown.length===n?target_hits/n:null,closed_green_rate:n?green/n:null,profit_factor:loss?gain/loss:null,pf_note:!loss?'No modeled losses; PF unavailable':null};
}
export function metricText(s,{suppressSmall=false}={}){
 const rate=v=>Number.isFinite(v)&&(!suppressSmall||s.n>=20)?(100*v).toFixed(0)+'%':'unavailable';
 return `Target hit %: ${rate(s?.target_hit_rate)} · Closed green %: ${rate(s?.closed_green_rate)} · PF: ${Number.isFinite(s?.profit_factor)?s.profit_factor.toFixed(2):'unavailable'} · n=${s?.n??'not supplied'}`;
}
export const ALERT_PROFILES={
 ON_LOW:{label:'ON-Low Hold + VIX Fade',side:1,confidence:'MEDIUM',rank:2,reported:{weeks:13,target_hit_rate:.38,first_scale_hit_rate:.44,closed_green_rate:.74,profit_factor:3.6,n:null}},
 MORNING_HIGH:{label:'Morning High Rejection',side:-1,confidence:'MEDIUM · SMALL SAMPLE',rank:2,reported:{target_hit_rate:null,closed_green_rate:.82,profit_factor:2.9,n:22}},
 BOX_BREAK:{label:'Call Trigger Break from Box',side:1,confidence:'MEDIUM · UNSTABLE',rank:2,reported:{target_hit_rate:.48,closed_green_rate:.75,profit_factor:3.4,n:null}},
 LEVEL_BOUNCE:{label:'Level Bounce',confidence:'LOW CONFIDENCE',rank:1,reported:{weeks:13,target_hit_rate:null,closed_green_rate:.47,profit_factor:.92,n:null}},
 MAIN:{label:'Score flip',confidence:'LOW · UNCALIBRATED',rank:1,reported:{target_hit_rate:null,closed_green_rate:null,profit_factor:null,n:null}}
};
