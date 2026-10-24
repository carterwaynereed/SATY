// Pure presentation model. The server owns event selection and the one-signal
// budget; the browser never promotes a watch item or fabricates a live signal.
export const TICKERS = ['SPY','SPX','AAPL','GOOGL'];
const finite = Number.isFinite;
const point = value => finite(value) ? value : finite(value?.price) ? value.price : null;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const priceText = value => finite(value) ? value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
export const currencyText = value => finite(value) ? `${value < 0 ? '−' : value > 0 ? '+' : ''}$${Math.abs(value).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:1})}` : 'Unavailable';
export function timeText(value){const t=Date.parse(value);return finite(t)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(t)+' ET':'Time unavailable';}
export function dayText(day){const t=Date.parse(`${day}T12:00:00Z`);return finite(t)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'}).format(t):'Session unavailable';}
export function easternDay(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
export function isFresh(snapshot,now=Date.now()){
  const age=now-Date.parse(snapshot?.health?.price_asof),session=snapshot?.session;
  return snapshot?.health?.state==='CURRENT'&&age>=0&&age<=225000&&session?.date===easternDay(now)&&now>=Date.parse(session.open)&&now<Date.parse(session.close);
}
export function momentumView(bundle,{now=Date.now(),failed=false,loading=false}={}){
  const m=bundle?.momentum,signal=m?.signal??null,day=m?.session_date??easternDay(now),currentDay=day===easternDay(now);
  const snapshot=signal?bundle?.symbols?.[signal.symbol]:null;
  const anyFresh=Object.values(bundle?.symbols??{}).some(s=>isFresh(s,now));
  const fresh=!failed&&currentDay&&(signal?isFresh(snapshot,now):anyFresh);
  const held=m?.state==='DATA HOLD'||m?.status==='DATA HOLD'||signal?.live===false||signal?.read_only===true;
  const age=now-Date.parse(signal?.entry_at),validEntry=finite(signal?.entry)&&age>=0;
  let status='WAIT',reason='We’re watching for one clear move. A quiet day can stay quiet.';
  if(loading&&!bundle){status='CONNECTING';reason='Checking confirmed prices and today’s signal.';}
  else if(failed){status='DATA HOLD';reason='The latest update could not be read. Retained values are reference only.';}
  else if(!m){status='DATA HOLD';reason='The momentum tracker is awaiting verified data.';}
  else if(!fresh){status='WAIT';reason=currentDay?'The regular session is closed or fresh confirmed bars are unavailable.':`Showing ${dayText(day)} as a reference. No new signal is active.`;if(currentDay&&Object.values(bundle?.symbols??{}).some(s=>['STALE','UNAVAILABLE'].includes(s?.health?.state))){status='DATA HOLD';reason='Fresh confirmed bars are unavailable. Signal guidance is paused.';}}
  else if(held){status='DATA HOLD';reason=m.reason??'The daily signal record could not be verified. Guidance is paused.';}
  else if(signal){status=signal.status??'WAIT';reason=signal.reason??'Tracking the confirmed move.';if(!validEntry&&!['EXIT','DATA HOLD'].includes(status)){status='WAIT';reason='A setup is confirmed. Waiting for its next-bar opening price.';}}
  else if(m.reason){reason=m.reason;}
  else if(m.holds?.length){reason=m.holds[0];status='DATA HOLD';}
  if(!['WAIT','HOLD','GET READY TO EXIT','EXIT','DATA HOLD','CONNECTING'].includes(status))status='WAIT';
  const tone=status==='HOLD'?'green':status==='GET READY TO EXIT'?'amber':status==='EXIT'?'red':'neutral';
  const direction=signal?.direction??(signal?.side===1?'CALL':signal?.side===-1?'PUT':null),entry=point(signal?.entry),target=point(signal?.target),stop=point(signal?.stop),last=point(snapshot?.market?.last),distance=target!==null&&entry!==null?Math.abs(target-entry):null;
  const progress=signal?.target_hit?100:finite(last)&&distance>0?Math.min(100,Math.max(0,(last-entry)*(direction==='PUT'?-1:1)/distance*100)):0;
  const title=signal&&direction?`${signal.symbol} ${direction}`:loading&&!bundle?'Getting the day ready.':'Waiting for a clear move.';
  const setup=String(signal?.setup??'Momentum setup').replaceAll('_',' ');
  const endSession=snapshot?.session??Object.values(bundle?.symbols??{}).find(x=>x.session?.date===day)?.session;
  const suppliedEnd=Date.parse(signal?.tracking_deadline),end=finite(suppliedEnd)?suppliedEnd:Date.parse(endSession?.close)-300000,deadline=finite(end)?timeText(new Date(end).toISOString()):'five minutes before the close';
  const second=m?.second_signal;
  const secondText=second?`${second.symbol} ${second.direction??(second.side===1?'CALL':'PUT')} · ${String(second.setup??'Watch candidate').replaceAll('_',' ')} · research only`:'No additional watch candidate.';
  return {status,tone,reason,title,signal,direction,setup,entry,target,stop,last,progress,day,deadline,currentDay,fresh,reference:!!signal&&!fresh,issued:signal?1:0,nextLevel:point(signal?.next_level),nextLevelLabel:signal?.next_level?.label??'Next Saty level',structuralStop:point(signal?.structural_stop),defendedLevel:point(signal?.defended_level),secondText,stats:m?.stats??{},version:m?.version??'Awaiting version',holds:m?.holds??[]};
}
const metric=(label,value,note,cls='')=>`<div class="metric ${cls}"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd><span>${escapeHTML(note)}</span></div>`;
export function momentumCardHTML(view){
  const v=view,s=v.signal,hasSignal=!!s,arrow=v.direction==='PUT'?'↘':'↗',levels=Number.isInteger(s?.levels_covered)&&s.levels_covered>=0?s.levels_covered:0;
  const subtitle=hasSignal?`${v.setup} · ${timeText(s.entry_at??s.decision_at)}${v.reference?' · reference only':''}`:'Confirmed 3-minute bars · one signal across four markets';
  const targetNote=s?.target_hit?'Milestone reached · keep tracking':'+0.236 daily ATR from entry';
  return `<div class="tracker-top"><p class="eyebrow">MOMENTUM TRACKER</p><span class="signal-budget">${v.issued} of 1 signal${v.currentDay?' today':' · '+escapeHTML(dayText(v.day))}</span></div>
    <div class="tracker-heading"><div><h2>${hasSignal?`<span class="direction-arrow" aria-hidden="true">${arrow}</span>`:''}${escapeHTML(v.title)}</h2><p class="signal-subtitle">${escapeHTML(subtitle)}</p></div><span class="status-badge ${v.tone}"><span class="status-dot" aria-hidden="true"></span>${escapeHTML(v.status)}</span></div>
    <p class="signal-reason" role="status">${escapeHTML(v.reason)}</p>
    <dl class="signal-metrics">${metric('Entry',priceText(v.entry),hasSignal?'Modeled next-bar open':'After a confirmed setup')}${metric('Momentum target',priceText(v.target),targetNote,'target-metric')}${metric('Stop',priceText(v.stop),'0.3 ATR adverse move','stop-metric')}${metric('Next Saty level',priceText(v.nextLevel),v.nextLevel!==null?v.nextLevelLabel:'Available after entry')}</dl>
    <div class="tracker-bottom"><div class="progress-meta"><span>${s?.target_hit?'Momentum achieved':hasSignal?'Progress to momentum target':'No signal yet'}</span><strong>${hasSignal?`${levels} level${levels===1?'':'s'} covered`:'No trade required'}</strong></div><div class="progress-track" role="progressbar" aria-label="Progress to momentum target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v.progress)}"><span style="width:${v.progress.toFixed(2)}%"></span></div><p class="tracker-rule">${hasSignal&&v.structuralStop!==null?`Also ends on a confirmed close ${v.direction==='PUT'?'above':'below'} ${priceText(v.structuralStop)}. `:''}No new entries after 3 PM · tracking ends ${v.deadline.startsWith('five')?'':'at '}${escapeHTML(v.deadline)}.</p></div>`;
}
export function watchView(bundle,{selected='SPY',now=Date.now(),failed=false}={}){
  return TICKERS.map(symbol=>{const s=bundle?.symbols?.[symbol],r=s?.radar,fresh=!failed&&isFresh(s,now),score=finite(r?.score)?r.score:null,highlight=fresh&&r?.highlight===true;
    return {symbol,selected:symbol===selected,price:priceText(s?.market?.last),score,lean:r?.lean===1?'↑':r?.lean===-1?'↓':'',directionTone:fresh&&r?.lean===1?'bull':fresh&&r?.lean===-1?'bear':'inactive',highlight,state:!s?'Awaiting data':!fresh?'Reference':highlight?'Direction heads-up':'Watching'};
  }).sort((a,b)=>(b.score??-1)-(a.score??-1)||TICKERS.indexOf(a.symbol)-TICKERS.indexOf(b.symbol));
}
export function watchHTML(rows){return rows.map(r=>`<button type="button" class="watch-chip${r.selected?' selected':''}${r.highlight?' highlighted':''}" data-ticker="${r.symbol}" aria-pressed="${r.selected}" aria-label="View ${r.symbol} market context"><span class="watch-top"><strong>${r.symbol}</strong><span class="watch-lean ${r.directionTone??'inactive'}" aria-hidden="true">${r.lean}</span><span class="watch-score">${r.score===null?'—':r.score}<small>/100</small></span></span><span class="watch-bottom"><span>${r.price}</span><span>${r.state}</span></span></button>`).join('');}
export function statsView(stats={}){
  const n=Number.isInteger(stats.n)&&stats.n>=0?stats.n:null,closedN=Number.isInteger(stats.closed_n)&&stats.closed_n>=0?stats.closed_n:null,held=stats.state==='DATA HOLD'||n===null,rate=(value,denominator=n)=>held?'Unavailable':denominator>=20&&finite(value)?`${Math.round(value*100)}%`:'Not enough data';
  const ci=Array.isArray(stats.interval)&&stats.interval.length===2&&stats.interval.every(finite)?`${Math.round(stats.interval[0]*100)}–${Math.round(stats.interval[1]*100)}%`:'Unavailable';
  return {n,closedN,held,headline:held?'Forward evidence is temporarily unavailable.':n?`${stats.wins??stats.target_hits??0}/${n} momentum targets reached`:'Forward tracking begins with this version',target:rate(stats.win_rate??stats.target_hit_rate),green:rate(stats.closed_green_rate,closedN??0),pf:!held&&closedN!==null&&finite(stats.profit_factor)?stats.profit_factor.toFixed(2):'Unavailable',interval:held?'Unavailable':ci,unresolved:stats.unresolved_n??stats.unresolved??0};
}
