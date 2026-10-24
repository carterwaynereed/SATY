import {ALERT_PROFILES,metricText,outcomeStats} from './outcome-stats.mjs';
import {chartLevels,drawChartOverlays} from './chart-overlays.mjs';
import {analyzeEOD} from './eod-analysis.mjs';
import {sessionMode} from './session-mode.mjs';
const finite=Number.isFinite,arr=x=>Array.isArray(x)?x:[];
const money=x=>finite(x)?x.toFixed(2):'—';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const distance=(level,price)=>finite(level)&&finite(price)&&price>0?`${level-price>=0?'+':'−'}$${money(Math.abs(level-price))} (${((level/price-1)*100).toFixed(2)}%)`:'unavailable';
export function replayStat(target,snapshot){
 const p=target?.probability,n=p?.n??0,interval=p?.interval;
 // Use only the engine's measured exact-cell event with its chronology/feed gates.
 if(n<20||!finite(p?.display_probability)||snapshot?.health?.source?.baseline_compatible!==true||!Array.isArray(interval)||interval.length!==2||!interval.every(finite))return `Target hit % withheld · n=${n}. ${p?.reason||'No matching measured event.'} · Closed green % unavailable · PF unavailable`;
 return `Target hit % (${p.event}) · ${(p.display_probability*100).toFixed(0)}%, n=${n}; Wilson 95% ${interval.map(x=>(x*100).toFixed(0)+'%').join('–')} · Closed green %: unavailable · PF: unavailable · DEVELOPMENT (correlated sessions).`;
}
function liveAlertExitModel(snapshot,options){
 const ts=arr(snapshot.live_alerts?.trades).filter(t=>finite(t.entry)),t=ts.find(t=>t.id===options.selectedId)??ts.find(t=>t.status==='TRACKING')??ts.at(-1);
 const x=bounceExitModel({...snapshot,live_alerts:null,level_bounce:{trades:ts,position:t?.status==='TRACKING'?t:null,entries_today:snapshot.live_alerts.ticker_total}},options);
 if(!t)return x;
 x.setup={...t,side:t.side===1?'LONG':'SHORT'};x.policy_note=`${t.setup} · All live alerts ${snapshot.live_alerts.global_total}/5 · Ticker ${snapshot.live_alerts.ticker_total}/3 · No new entries after 3 PM`;x.stop.label=(t.trail?'Trailing':'Initial')+' 0.35 ATR stop';x.targets=[...(!t.first_scale_hit&&t.scale?[t.scale]:[]),t.target];x.lines=[...x.targets.map(l=>({...l,exitRole:'target'})),{...x.stop,exitRole:'stop'}];
 x.stats=metricText(ALERT_PROFILES[t.setup_id]?.reported??{})+' · Reported replay, not independently reproduced.';
 x.action=x.status==='DATA HOLD'?'DATA HOLD: confirmed bars or exact time-exit minute missing; no new instruction.':t.status==='CLOSED'?`${t.exit_reason} at $${money(t.exit)}. Target hit: ${t.target_hit?'yes':'no'}; closed green: ${t.return_pct>0?'yes':'no'}.`:'Half scale at 0.3 ATR; remaining target 0.4 ATR. Trail 0.35 ATR behind confirmed close after scale; hold to stop, target or 15:55. GET READY is an alert only.';
 x.candidates=[...arr(snapshot.approved_rules?.trades),...arr(snapshot.level_bounce?.trades),...ts].map(t=>({...t,side:t.side===1?'LONG':'SHORT'}));return x;
}
function bounceExitModel(snapshot,options){
 const b=snapshot.level_bounce,all=arr(b.trades),t=all.find(t=>t.id===options.selectedId)??b.position??all.at(-1);
 const convert=t=>({...t,side:t.side===1?'LONG':'SHORT',targets:[],setup:'Level Bounce'});
 const x=exitModel({...snapshot,level_bounce:null,approved_rules:null,signals:all.map(convert)},{...options,selectedId:t?.id});
 x.candidates=[...arr(snapshot.approved_rules?.trades).map(t=>({...t,side:t.side===1?'LONG':'SHORT',setup:'Approved score flip'})),...all.map(convert)];
 if(!t)return x;
 x.stop={label:'Level Bounce fixed stop',price:t.stop};x.targets=[t.target];x.lines=[{...t.target,exitRole:'target'},{...x.stop,exitRole:'stop'}];x.fixed_target_only=true;
 x.checks=[{label:'Within 0.1 ATR of target (alert only)',met:finite(x.price)&&Math.abs(x.price-t.target.price)<=.1*x.atr}];
 x.policy_note=`Level Bounce · Trades today: ${b.entries_today} · No new entries after 3 PM · ${b.cooldown_until&&Date.parse(b.cooldown_until)>(options.now??Date.now())?'Loss cooldown until '+b.cooldown_until:'Cooldown ready'}`;
 x.stats='LOW CONFIDENCE · 13-week reported replay: Target hit % unavailable; Closed green % 47%; PF 0.92; n not supplied. Forward-testing from Oct 26, 2026. Earlier five-week claim withdrawn.';
 if(t.status==='CLOSED'){x.status=(x.reference?'REFERENCE · ':'')+(t.exit_reason==='STOP HIT'?'STOP HIT':'EXIT / TAKE PROFIT');x.tone=x.reference?'neutral':'red';x.action=`${x.reference?'Replay reference. ':''}${t.exit_reason} at $${money(t.exit)} (${t.exit_at}).`;}
 else if(options.failed||t.time_exit_pending||t.status==='UNRESOLVED'||['STALE','UNAVAILABLE'].includes(snapshot.health?.state)){x.status='DATA HOLD';x.tone='neutral';x.action=t.time_exit_pending?'Exact 15:55 1m close missing; no exit price invented.':'Retained modeled setup; fresh complete bars required.';}
 else{x.status=(x.reference?'REFERENCE · ':'')+(x.checks[0].met?'GET READY TO EXIT':'HOLD');x.tone=x.reference?'neutral':x.checks[0].met?'amber':'green';x.action='Hold until fixed stop, target or 15:55 ET. No ribbon exit, opposite-flip exit, breakeven or early cut. GET READY is an alert only.';}
 return x;
}
function approvedExitModel(snapshot,options){
 const policy=snapshot.approved_rules,now=options.now??Date.now(),trades=arr(policy.trades).map(t=>({...t,side:t.side===1?'LONG':'SHORT',targets:[],setup:t.setup??'Approved score flip'}));
 const chosen=trades.find(t=>t.id===options.selectedId)??trades.find(t=>t.status==='TRACKING')??trades.at(-1);
 const x=exitModel({...snapshot,approved_rules:null,signals:trades},{...options,selectedId:chosen?.id});
 x.candidates.push(...arr(snapshot.live_alerts?.trades).filter(t=>finite(t.entry)).map(t=>({...t,side:t.side===1?'LONG':'SHORT'})));
 x.candidates.push(...arr(snapshot.level_bounce?.trades).map(t=>({...t,side:t.side===1?'LONG':'SHORT',setup:'Level Bounce'})));
 const original=arr(policy.trades).find(t=>t.id===chosen?.id),fresh=!x.reference&&original?.status==='TRACKING';
 x.stats=metricText(outcomeStats(policy.trades),{suppressSmall:true})+' · Current session model; no calibrated probability.';
 const seconds=policy.cooldown_until?Math.max(0,Math.ceil((Date.parse(policy.cooldown_until)-now)/1000)):0,currentDay=sessionMode(now).day===snapshot.session?.date;
 x.policy_note=`Trades today: ${currentDay?policy.entries_today:0} · Cooldown: ${seconds?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'ready'} · No new entries after 3 PM${currentDay?'':' · prior session reference '+snapshot.session?.date}`;
 if(!original){x.action=policy.pending?'Confirmed score flip. Model awaits the next available bar open; no order or historical fill is asserted.':'WAIT for a new confirmed 60% score flip. '+x.policy_note;return x;}
 x.stop={label:original.runner?'Runner trailing stop':'Managed / 5-bar stop',price:original.stop};
 x.targets=original.target?[original.target]:[];
 x.lines=[...x.targets.map(t=>({...t,exitRole:'target'})),{...x.stop,exitRole:'stop'}];
 if(options.failed||['STALE','UNAVAILABLE'].includes(snapshot.health?.state)){x.status='DATA HOLD';x.tone='neutral';x.action='Retained modeled setup only. Fresh confirmed regular-session bars are required.';}
 else if(original.time_exit_pending){x.status='DATA HOLD';x.tone='neutral';x.action='15:55 time exit requires its confirmed 1m close. No exit price is invented.';}
 else if(original.status==='CLOSED'){
  x.status=(x.reference?'REFERENCE · ':'')+(original.exit_reason==='STOP HIT'?'STOP HIT':'EXIT / TAKE PROFIT');x.tone=x.reference?'neutral':'red';x.action=`${x.reference?'Historical replay. ':''}EXIT · ${original.exit_reason} at $${money(original.exit)} (${original.exit_at}).`;
 }else if(original.status==='UNRESOLVED'){x.status='DATA HOLD';x.tone='neutral';x.action='Missing regular-session bar. This modeled trade is unresolved.';}
 else if(original.runner){x.status=(x.reference?'REFERENCE · ':'')+'RUNNER';x.tone=fresh?'green':'neutral';x.action=`RUNNER: trail stop to ${original.side===1?'target −':'target +'} 0.1 ATR ($${money(original.stop)}), next target ${original.target.label}% ($${money(original.target.price)}).`;
 }else{const ready=x.checks.some(c=>c.met===true);x.status=(x.reference?'REFERENCE · ':'')+(ready?'GET READY TO EXIT':'HOLD');x.tone=fresh?(ready?'amber':'green'):'neutral';x.action=ready?'GET READY is an alert only. Hold until an actual stop, support loss, opposite flip, target exit, or 15:55.':'HOLD · Next ATR target and invalidation are shown. No order is sent.';}
 return x;
}
export function exitModel(snapshot,{selectedId,now=Date.now(),manual=null,failed=false}={}){
 if(snapshot?.live_alerts?.trades?.some(t=>finite(t.entry)&&(t.id===selectedId||!selectedId&&t.status==='TRACKING')))return liveAlertExitModel(snapshot,{selectedId,now,manual,failed});
 if(snapshot?.level_bounce&&(arr(snapshot.level_bounce.trades).some(t=>t.id===selectedId)||!selectedId&&!snapshot.approved_rules?.position&&snapshot.level_bounce.position))return bounceExitModel(snapshot,{selectedId,now,manual,failed});
 if(snapshot?.approved_rules)return approvedExitModel(snapshot,{selectedId,now,manual,failed});
 const s=snapshot,m=s?.market??{},price=m.last,atr=m.atr14,bars=arr(s?.bars),last=bars.at(-1),previous=bars.at(-2),mode=sessionMode(now,s?.session);
 const candidates=arr(s?.signals).filter(x=>finite(x.entry)&&finite(x.stop)&&!['CANCELLED','PENDING_ENTRY','EXPIRED'].includes(x.status));
 const setup=candidates.find(x=>x.id===selectedId)??candidates.filter(x=>x.status==='TRACKING').at(-1)??candidates.at(-1);
 const live=!failed&&s?.health?.state==='CURRENT'&&mode.mode==='REGULAR'&&s?.session?.date===mode.day&&now-Date.parse(s?.health?.price_asof)<=225000&&now>=Date.parse(s?.health?.price_asof);
 let reference=!live;
 if(!setup||!finite(price)||!(atr>0))return {status:failed?'DATA HOLD':'NO ACTIVE SETUP',tone:'neutral',reference:true,candidates,setup,targets:[],checks:[],lines:[],action:'Select a confirmed replay setup when one is available. No position or order is tracked.'};
 reference=reference||setup.status!=='TRACKING';
 const side=setup.side==='LONG'?1:-1,after=bars.filter(b=>Date.parse(b.time)>=Date.parse(setup.entry_at)&&Date.parse(b.time)+180000<=now);
 const originalHit=after.some(b=>side===1?b.low<=setup.stop:b.high>=setup.stop);
 const trigger=arr(s.levels).find(x=>x.label===(side===1?'+23.6':'-23.6'))?.price;
 const ribbon3=s.ribbon?.ema34,ribbon10=s.ribbon?.trend10?.[34];
 const trendKnown=[-1,1].includes(arr(s.evidence_weights?.features).find(x=>x.id==='ribbon10')?.direction)&&finite(ribbon10);
 const invalidations=[{label:'Original stop',price:setup.stop},{label:'Back through trigger',price:trigger},{label:'Lost 3m ribbon (34 EMA)',price:ribbon3},...(trendKnown?[{label:'Lost 10m ribbon (34 EMA)',price:ribbon10}]:[])].filter(x=>finite(x.price));
 const breached=invalidations.filter(x=>side*(price-x.price)<0);
 const stop=invalidations.filter(x=>side*(price-x.price)>=0).sort((a,b)=>side*(b.price-a.price))[0]??invalidations[0];
 // Target selected before this candle, so a just-touched level is not skipped.
 const anchor=previous?.close??price;
 const eligible=arr(s.levels).filter(x=>finite(x.price)&&Math.abs(x.multiple??parseFloat(x.label)/100)<=1&&side*(x.price-setup.entry)>0).sort((a,b)=>side*(a.price-b.price));
 const target=eligible.find(x=>side*(x.price-anchor)>0)??eligible.find(x=>side*(x.price-price)>0);
 const targets=target?eligible.filter(x=>side*(x.price-target.price)>=0).slice(0,3):[];
 const touched=target&&last&&side*(side===1?last.high-target.price:last.low-target.price)>=0;
 const width=b=>b&&finite(b.ema8)&&finite(b.ema34)?Math.abs(b.ema8-b.ema34):null;
 const w=width(last),pw=width(previous),flat=finite(w)&&finite(pw)?w<=.03*atr||w<pw*.8:null;
 const phase=last?.phase,old=previous?.phase;
 const phaseBack=finite(phase)&&finite(old)?side*old>=60&&side*phase<60||side*old>0&&side*phase<=0:null;
 const session={...s.session,daily_atr:atr},three=analyzeEOD(bars,3,session,now),one=analyzeEOD(s.one_minute_bars,1,session,now);
 const divergence=result=>result.state==='CURRENT'?result.divergence.some(x=>x.type===(side===1?'BEARISH':'BULLISH')):null;
 const oneFresh=s.one_minute_health?.state==='CURRENT'&&now-Date.parse(s.one_minute_health.price_asof)<=85000;
 const vwap=m.vwap,lostVWAP=finite(vwap)?side*(price-vwap)<0:null;
 const manualAge=now-Date.parse(manual?.asof),manualValid=manual?.symbol===m.symbol&&manualAge>=0&&manualAge<=15*60000&&manual?.method&&manual?.expiry_scope;
 const power=mode.minute>=930&&mode.minute<960&&mode.mode==='REGULAR';
 const mp=manualValid?manual.max_pain?.spot:null,nodes=manualValid?arr(manual.gex?.nodes).filter(x=>finite(x.gamma)&&x.gamma<0&&finite(x.strike)):[];
 const eye=nodes.sort((a,b)=>a.gamma-b.gamma)[0]?.strike;
 const checks=[
  ['Within 0.1 ATR of next target',target?Math.abs(target.price-price)<=.1*atr:null],
  ['3m ribbon flattening / compressing',flat],
  ['Phase leaving ±60 extreme or crossing back through zero',phaseBack],
  ['1m momentum divergence',oneFresh?divergence(one):null],
  ['3m momentum divergence',divergence(three)],
  ['Losing session VWAP',lostVWAP],
  ['After 15:30: near max-pain pull',power&&finite(mp)?Math.abs(mp-price)<=.1*atr:null],
  ['After 15:30: near largest negative gamma node',power&&finite(eye)?Math.abs(eye-price)<=.1*atr:null]
 ].map(([label,met])=>({label,met}));
 let status=originalHit?'STOP HIT':breached.length?'EXIT / TAKE PROFIT':touched?'EXIT / TAKE PROFIT':checks.some(x=>x.met===true)?'GET READY TO EXIT':'HOLD';
 const tone=originalHit||status==='EXIT / TAKE PROFIT'?'red':status==='HOLD'?'green':'amber';
 const measured=arr(setup.targets).find(t=>t.price===target?.price);
 const action=originalHit?'Original stop was touched in replay; do not treat this setup as an open position.':breached.length?`Consider exiting: ${breached.map(x=>x.label).join(', ')} breached on a confirmed close.`:target?`Consider trimming half at ${target.label}% ATR (${distance(target.price,price)}), then review a trailing stop at ${stop?.label??'original stop'} $${money(stop?.price??setup.stop)}.`:'No higher ATR target within the 100% grid. Consider taking profit or reviewing the stop.';
 return {status:reference?(failed||s?.health?.state==='UNAVAILABLE'||s?.health?.state==='STALE'?'DATA HOLD':'REFERENCE · '+status):status,tone:reference?'neutral':tone,reference,candidates,setup,price,atr,targets,stop,invalidations,checks,atr_used:finite(m.day_high)&&finite(m.day_low)?(m.day_high-m.day_low)/atr:null,action:(reference?'Historical/reference only. ':'')+(status==='GET READY TO EXIT'?'GET READY is an alert only. Monitor target, stop and confirmed support; no take-profit action from this alert.':action),stats:replayStat(measured,s),lines:[...targets.map(t=>({...t,exitRole:'target'})),...(stop?[{...stop,exitRole:'stop'}]:[])]};
}
export function renderExitPanel(root,snapshot,options={}){
 const x=exitModel(snapshot,options),raw=options.extended,extended=raw?.state==='CURRENT'&&(options.failed||(options.now??Date.now())-Date.parse(raw.price_asof)>125000)?{state:'DATA HOLD',reason:'Extended feed failed or confirmed bar became stale'}:raw,mode=sessionMode(options.now??Date.now(),snapshot?.session);
 const extMode=mode.mode==='EXTENDED HOURS';
 const ext=extMode?`<div class="extended-card"><b>EXTENDED HOURS · ${esc(extended?.state??'DATA HOLD')}</b><p>${esc(extended?.reason??'No confirmed extended bars available.')}</p>${extended?.state==='CURRENT'?`<p>${esc(extended.period)} · $${money(extended.price)} · confirmed ${esc(extended.price_asof)}</p><p>Overnight / extended high $${money(extended.high)} · low $${money(extended.low)}. ${esc(extended.range_note)}</p><p>Gap preview ${distance(extended.price,extended.gap_basis)} versus last regular close $${money(extended.gap_basis)} · next open ${esc(extended.next_open??'calendar unavailable')}. Preview only.</p><div class="chip-row">${arr(extended.levels).filter(l=>['-100','-61.8','-38.2','-23.6','0','+23.6','+38.2','+61.8','+100'].includes(l.label)).map(l=>`<span class="tag">${esc(l.label)}% $${money(l.price)} · ${distance(l.price,extended.price)}</span>`).join('')}</div>`:''}<small>60-second refresh · no RTH stats, WAIT ledger, or challenger contribution. SPX is closed.</small></div>`:'';
 root.innerHTML=`${ext}<div class="panel-head"><h2>Exit panel <small>· signal only</small></h2><span class="exit-badge ${x.tone}" role="status">${esc(x.status)}</span></div>${x.policy_note?`<p class="policy-note">${esc(x.policy_note)}</p>`:''}<label class="exit-select">Setup <select aria-label="Exit setup"><option value="">Auto · latest tracking setup</option>${x.candidates.map(s=>`<option value="${esc(s.id)}" ${s.id===options.selectedId?'selected':''}>${esc(s.side+' · '+s.setup+' · '+s.decision_at+' · '+s.status)}</option>`).join('')}</select></label>${x.setup?`<p class="fine">${esc(x.setup.side)} · ${esc(x.setup.setup)} · replay entry $${money(x.setup.entry)} · ${esc(x.setup.status)}. No actual position is tracked.</p>`:''}<div class="exit-targets">${x.targets.map(t=>`<div><small>${esc(x.fixed_target_only?t.label:'Next '+t.label+'% ATR')}</small><strong>$${money(t.price)}</strong><small>${distance(t.price,x.price)}</small></div>`).join('')}${x.stop?`<div><small>Invalidation: ${esc(x.stop.label)}</small><strong>$${money(x.stop.price)}</strong><small>${distance(x.stop.price,x.price)}</small></div>`:''}</div>${finite(x.atr_used)?`<label>Day range used ${(x.atr_used*100).toFixed(0)}% of daily ATR <progress max="100" value="${Math.min(100,x.atr_used*100)}"></progress></label>`:''}<div class="exit-checks">${x.checks.map(c=>`<span class="${c.met?'met':''}">${c.met===true?'✓ MET':c.met===false?'○ NOT MET':'— UNAVAILABLE'} · ${esc(c.label)}</span>`).join('')}</div><p class="exit-action">${esc(x.action)}</p><p class="fine">${esc(x.stats??'No measured exit sample · n=0.')} Exit cues are unvalidated context, not outcome probabilities. Distances are underlying dollars / index points, not option premium.</p>`;
 root.querySelector('select').onchange=e=>options.onSelect?.(e.target.value);
 return x;
}
// Small shared EOD chart: confirmed RTH candles, labeled stop and target lines.
export function drawExitChart(canvas,snapshot,model,{all=false}={}){
 const bars=arr(snapshot?.bars).slice(-100);if(!bars.length)return;
 const rect=canvas.getBoundingClientRect(),w=rect.width||800,h=rect.height||220,dpr=Math.min(globalThis.devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const right=w-Math.min(132,w*.38),levels=chartLevels(snapshot,model,{all});
 const values=[...bars.flatMap(b=>[b.high,b.low]),...levels.filter(l=>l.exitRole==='stop'||l.exitRole==='target').map(l=>l.price)].filter(finite),low=Math.min(...values),high=Math.max(...values),range=high-low||1,y=p=>15+(high-p)/range*(h-35);
 ctx.clearRect(0,0,w,h);bars.forEach((b,i)=>{ctx.strokeStyle=b.close>=b.open?'#bce58c':'#eb9b91';ctx.beginPath();ctx.moveTo(5+i*(right-10)/bars.length,y(b.low));ctx.lineTo(5+i*(right-10)/bars.length,y(b.high));ctx.stroke();});
 drawChartOverlays(ctx,levels,{left:3,right,width:w,top:10,bottom:h-15,y});
 canvas.setAttribute('aria-label',`Confirmed RTH chart. ${levels.map(l=>l.exitRole+' '+l.label+' '+money(l.price)).join('; ')}`);
}
