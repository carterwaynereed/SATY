/* Buildless UI. External values enter the DOM only through textContent. */
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const number = (value, digits = 2) => finite(value) ? value.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
export const percent = value => finite(value) ? `${Math.round(value * 100)}%` : '—';
const dateValue = value => typeof value === 'string' ? Date.parse(value) : NaN;
const etDate = value => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const time = value => Number.isFinite(dateValue(value)) ? new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : '—';
const signed = (value, digits = 2) => finite(value) ? `${value > 0 ? '+' : ''}${number(value, digits)}` : '—';
const readable = value => typeof value === 'string' ? value.replaceAll('_',' ').replaceAll('-',' ') : 'Unavailable';
const safeList = value => Array.isArray(value) ? value : [];
const interval = value => Array.isArray(value) && value.length === 2 && value.every(finite) ? `${percent(value[0])}–${percent(value[1])}` : 'unavailable';

export function snapshotHealth(snapshot, now = Date.now(), fetchFailed = false) {
  if (fetchFailed) return {state:'DATA HOLD',tone:'hold',reason:'The last update could not be read. Any displayed data is a retained snapshot.'};
  if (!snapshot || !finite(snapshot.market?.last)) return {state:'DATA HOLD',tone:'hold',reason:snapshot?.health?.reason || 'No market snapshot has been published.'};
  const h = snapshot.health || {}, asof = dateValue(h.price_asof), age = (now - asof) / 1000;
  if (!Number.isFinite(asof) || age < -90) return {state:'DATA HOLD',tone:'hold',reason:'Snapshot time is missing or ahead of the browser clock.'};
  if (['UNAVAILABLE','STALE'].includes(h.state)) return {state:h.state === 'STALE' ? 'STALE SNAPSHOT' : 'DATA HOLD',tone:'hold',reason:h.reason || 'The source did not pass freshness checks.',age};
  const session = snapshot.session || {}, open = dateValue(session.open), close = dateValue(session.close);
  if (session.date && session.date !== etDate(now) && age > 43200) return {state:'DATED SNAPSHOT',tone:'closed',reason:`Showing the ${session.date} session. No current-session decision is available.`,age};
  if (Number.isFinite(open) && Number.isFinite(close) && now >= open && now < close) {
    if (age > (finite(h.ttl_seconds) ? h.ttl_seconds : 900)) return {state:'STALE SNAPSHOT',tone:'hold',reason:'The confirmed close is older than the freshness limit. Await the next successful run.',age};
    return {state:'CURRENT SNAPSHOT',tone:'current',reason:`Scheduled ${session.refresh_minutes || 10}-minute updates · confirmed 3m bars · not a live quote.`,age};
  }
  if (session.status === 'OPEN' && !Number.isFinite(close)) return {state:'DATA HOLD',tone:'hold',reason:'Session boundaries are unavailable.',age};
  return {state:session.status === 'PREMARKET' ? 'PREMARKET' : 'SESSION CLOSED',tone:'closed',reason:h.reason || 'Reference snapshot. New entries are not being evaluated.',age};
}

export function uwHealth(uw, now = Date.now()) {
  if (!uw || uw.status !== 'manual') return {valid:false,label:'MANUAL / PLACEHOLDER',reason:'Awaiting a manual snapshot. Missing values are unavailable, not zero.'};
  const ts = dateValue(uw.asof), age = (now - ts) / 60000, ttl = finite(uw.ttl_minutes) && uw.ttl_minutes > 0 ? uw.ttl_minutes : 15;
  if (!Number.isFinite(ts) || age < -1) return {valid:false,label:'MANUAL / UNVERIFIED',reason:'The manual snapshot needs a valid, nonfuture timestamp.'};
  if (age > ttl) return {valid:false,label:'MANUAL / STALE',reason:`Manual snapshot expired ${Math.floor(age - ttl)} minutes ago. Values below are historical context only.`};
  if (!['SPY','SPX'].includes(uw.symbol)) return {valid:false,label:'MANUAL / UNVERIFIED',reason:'Set an explicit SPY or SPX instrument basis.'};
  if (!uw.method || !uw.expiry_scope) return {valid:false,label:'MANUAL / UNVERIFIED',reason:'Methodology and expiry scope are required before gamma levels join the map.'};
  return {valid:true,label:'MANUAL / CURRENT',reason:`${uw.source || 'Unusual Whales'} · ${uw.symbol} basis · as of ${time(uw.asof)} ET · ${uw.expiry_scope}`};
}

export function probabilityView(probability) {
  const p = probability || {}, n = finite(p.n) ? p.n : null, episodes = finite(p.episodes) ? p.episodes : null;
  const rate = finite(p.display_probability) && p.display_probability >= 0 && p.display_probability <= 1 ? p.display_probability : null;
  const show = n >= 20 && episodes >= 20 && rate !== null;
  return {headline:show ? `${percent(rate)} historical hit rate` : 'Limited evidence · no headline probability',
    counts:finite(p.hits) && n !== null ? `${p.hits}/${n} target events · ${episodes === null ? 'episode count unverified' : `${episodes} episodes`} · ${finite(p.sessions) ? p.sessions : '—'} sessions` : 'No matching historical target events',
    interval:`95% interval: ${interval(p.interval)}`,
    event:p.event || 'Target before original stop by session close',show};
}

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const put = (id, value) => { const el = $(id); if (el) el.textContent = value ?? '—'; };
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const tint = (id, value) => { $(id)?.classList.toggle('positive', finite(value) && value > 0); $(id)?.classList.toggle('negative', finite(value) && value < 0); };
  let snapshot = null, evidence = null, uw = null, fetchFailed = false, fetching = false, lastUwValid = false;

  function updateHealth() {
    put('clock', `${time(new Date().toISOString())} ET`);
    const health = snapshotHealth(snapshot, Date.now(), fetchFailed);
    $('health-banner').className = `health-banner ${health.tone}`;
    put('health-label',health.state); put('health-reason',health.reason);
    put('health-age',finite(health.age) ? `${health.age < 60 ? '<1' : Math.floor(health.age / 60)} min since bar close` : '');
    const blocked = health.tone === 'hold' || health.state === 'DATED SNAPSHOT';
    const state = blocked ? 'DATA HOLD' : (health.tone === 'closed' ? 'WAIT' : readable(snapshot?.plan?.state || 'WAIT'));
    put('plan-state',state); $('plan-state').className = `badge ${blocked ? 'amber' : 'neutral'}`;
    put('plan-summary',blocked ? health.reason : snapshot?.plan?.summary || 'No confirmed setup is currently being tracked.');
    const uh = uwHealth(uw); if (uh.valid !== lastUwValid) { renderUW(); renderLevels(); renderChart(); }
  }

  function renderMarket() {
    const m = snapshot?.market || {}, r = snapshot?.ribbon || {}, s = snapshot?.session || {}, source = snapshot?.health?.source || {};
    put('last-price',number(m.last)); put('prev-close',number(m.prev_close)); put('atr',number(m.atr14));
    put('vwap',number(m.vwap)); put('atr-move',finite(m.change_atr) ? `${signed(m.change_atr * 100,1)}%` : '—');
    put('day-change',finite(m.change) ? `${signed(m.change)} (${finite(m.prev_close) && m.prev_close !== 0 ? `${signed(m.change / m.prev_close * 100)}%` : '—'})` : '—');
    tint('day-change',m.change); tint('atr-move',m.change_atr);
    put('quote-asof',Number.isFinite(dateValue(snapshot?.health?.price_asof)) ? `${etDate(dateValue(snapshot.health.price_asof))} · ${time(snapshot.health.price_asof)} ET close` : 'Waiting for market data');
    put('session-label',s.date ? `${s.date} · ${readable(s.status)} · RTH` : 'Session unavailable');
    const delayLabel = finite(source.delay_seconds) ? `${source.delay_seconds}s reported delay` : 'delay unknown';
    put('source-label',`${source.provider || 'Source unavailable'} · ${source.symbol || 'SPY'} · feed ${source.source_id || 'unverified'} · ${delayLabel} · confirmed 3m`);
    put('ribbon-state',readable(r.alignment)); put('ribbon-detail',r.price_position && !['UNAVAILABLE','UNKNOWN'].includes(String(r.price_position).toUpperCase()) ? `Price ${readable(r.price_position).toLowerCase()} ribbon` : 'Ribbon values unavailable');
    [8,13,21,34,48].forEach(period => put(`ema-${period}`,number(r[`ema${period}`])));
    put('conviction',readable(r.conviction)); put('phase',number(r.phase,1)); put('phase-detail',r.phase_slope !== null && r.phase_slope !== undefined ? `Slope: ${finite(r.phase_slope) ? signed(r.phase_slope,1) : readable(r.phase_slope)}` : 'Confirmed-bar phase');
    put('squeeze',r.squeeze === true ? 'ON' : r.squeeze === false ? 'OFF' : 'Unavailable');
    tint('phase',r.phase); tint('ribbon-state',String(r.alignment).toUpperCase().includes('BEAR') ? -1 : String(r.alignment).toUpperCase().includes('BULL') ? 1 : 0);
    put('version-label',`${snapshot?.strategy?.version || 'saty-sig-2.0'} · ${snapshot?.strategy?.session_basis || 'RTH'} variant`);
    const conditions=safeList(snapshot?.plan?.next_conditions), noteCounts=new Map();
    conditions.forEach(c=>{if(typeof c.note==='string' && c.note.trim())noteCounts.set(c.note.trim(),(noteCounts.get(c.note.trim())||0)+1);});
    const sharedNotes=[...noteCounts].filter(([,count])=>count>1).map(([note])=>note);
    const conditionRows=conditions.map(c=>{const div=node('div',undefined,'condition'),left=node('span',c.label || 'Reference');if(c.note && !sharedNotes.includes(String(c.note).trim()))left.append(node('small',c.note));div.append(left,node('strong',number(c.price)));return div;});
    $('next-conditions').replaceChildren(...conditionRows,...sharedNotes.map(note=>node('p',note,'conditions-shared-note')));
    $('conflicts').replaceChildren(...safeList(snapshot?.plan?.conflicts).map(c=>node('p',c)));
    $('runtime-notes').replaceChildren(...[...safeList(snapshot?.strategy?.notes),...safeList(snapshot?.health?.warnings),...safeList(snapshot?.footnotes)].map(n=>node('p',n)));
    updateHealth(); renderLevels(); renderChart(); renderSignals();
  }

  function manualLevels() {
    if (!uwHealth(uw).valid || uw.symbol !== 'SPY') return [];
    return [['Call wall',uw.gamma?.call_wall],['Put wall',uw.gamma?.put_wall],['Zero gamma',uw.gamma?.zero_gamma]].filter(([,p])=>finite(p)).map(([label,price])=>({label:`${label} · manual`,price,manual:true}));
  }
  function renderLevels() {
    const last = snapshot?.market?.last;
    const rows = [...safeList(snapshot?.levels),...manualLevels()].filter(l=>finite(l.price)).sort((a,b)=>b.price-a.price);
    if (!rows.length) { const tr=node('tr'); const td=node('td','No levels published','table-empty');td.colSpan=3;tr.append(td);$('levels-body').replaceChildren(tr);return; }
    if (finite(last)) rows.push({label:'Last confirmed close',price:last,current:true}); rows.sort((a,b)=>b.price-a.price);
    $('levels-body').replaceChildren(...rows.map(l=>{const tr=node('tr',undefined,l.current ? 'current-level' : l.manual ? 'manual-row' : '');tr.append(node('td',l.label || 'ATR level'),node('td',number(l.price),'numeric'),node('td',l.current ? '—' : signed(finite(last) ? l.price-last : l.distance),'numeric'));return tr;}));
  }

  function renderChart() {
    const bars = safeList(snapshot?.bars).filter(b=>[b.close,b.high,b.low].every(finite));
    if (!bars.length) {const empty=node('div',undefined,'empty-state');empty.append(node('span','⌁','empty-icon'),node('strong','Waiting for a confirmed session'),node('p','The next successful data run will draw the price map here.'));$('chart').replaceChildren(empty);return;}
    const chart=$('chart'),viewWidth=Math.max(320,Math.min(900,chart.clientWidth-16)),narrow=viewWidth<600,viewHeight=narrow?280:300;
    chart.style.height=narrow?'290px':'';
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${viewWidth} ${viewHeight}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${bars.length} confirmed SPY 3-minute bars with optional ATR and moving average lines. Last close ${number(bars.at(-1).close)}.`);
    const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));if(text!==undefined)e.textContent=text;svg.append(e);return e;};
    let lo=Math.min(...bars.map(b=>b.low)),hi=Math.max(...bars.map(b=>b.high));const spread=Math.max(hi-lo,.2);lo-=spread*.18;hi+=spread*.18;
    const left=12,right=viewWidth-64,top=14,bottom=viewHeight-26,axisX=right+10,priceX=right+7,priceWidth=51,x=i=>left+i*(right-left)/Math.max(bars.length-1,1),y=p=>bottom-(p-lo)/(hi-lo)*(bottom-top);
    const defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),clipRect=document.createElementNS(ns,'rect');clip.id='session-plot-clip';Object.entries({x:left,y:top,width:right-left,height:bottom-top}).forEach(([k,v])=>clipRect.setAttribute(k,String(v)));clip.append(clipRect);defs.append(clip);svg.append(defs);
    for(let i=0;i<=4;i++){const p=lo+(hi-lo)*i/4,py=y(p);add('line',{x1:left,x2:right,y1:py,y2:py,stroke:'#263141','stroke-width':.7});add('text',{x:axisX,y:py+3,fill:'#758399','font-size':10},number(p));}
    if ($('toggle-levels').checked) [...safeList(snapshot?.levels),...manualLevels()].filter(l=>finite(l.price)&&l.price>lo&&l.price<hi).forEach(l=>{const py=y(l.price);add('line',{x1:left,x2:right,y1:py,y2:py,stroke:l.manual?'#edc17d':'#61718a','stroke-dasharray':l.manual?'6 4':'3 5','stroke-width':.8,opacity:.65});add('text',{x:left+5,y:py-5,fill:l.manual?'#edc17d':'#a0aec1','font-size':8},l.label);});
    if ($('toggle-ribbon').checked) [['ema48','#536581'],['ema34','#647da7'],['ema21','#8ba5d8'],['ema8','#bacce8']].forEach(([key,color])=>{const points=bars.map((b,i)=>finite(b[key])?`${x(i)},${y(b[key])}`:null).filter(Boolean);if(points.length>1)add('polyline',{points:points.join(' '),fill:'none',stroke:color,'stroke-width':1,opacity:.65,'clip-path':'url(#session-plot-clip)'});});
    const width=Math.min(5,(right-left)/bars.length*.65);
    bars.forEach((b,i)=>{const rising=!finite(b.open)||b.close>=b.open,c=rising?'#6bdbc1':'#da898f';add('line',{x1:x(i),x2:x(i),y1:y(b.high),y2:y(b.low),stroke:c,'stroke-width':.9,opacity:.8});const open=finite(b.open)?b.open:b.close;add('rect',{x:x(i)-width/2,y:Math.min(y(open),y(b.close)),width,height:Math.max(Math.abs(y(open)-y(b.close)),1.2),fill:c,rx:.3});});
    const close=bars.at(-1).close,cy=y(close);add('line',{x1:x(bars.length-1),x2:priceX,y1:cy,y2:cy,stroke:'#6bdbc1','stroke-width':1,'stroke-dasharray':'2 3'});add('rect',{x:priceX,y:cy-9,width:priceWidth,height:18,rx:3,fill:'#24493e'});add('text',{x:priceX+priceWidth/2,y:cy+3,fill:'#b9f0df','font-size':10,'text-anchor':'middle'},number(close));
    [...new Set([0,Math.floor((bars.length-1)/3),Math.floor((bars.length-1)*2/3),bars.length-1])].forEach(i=>add('text',{x:x(i),y:viewHeight-7,fill:'#758399','font-size':9,'text-anchor':i===0?'start':i===bars.length-1?'end':'middle'},time(bars[i].time)));
    $('chart').replaceChildren(svg);
  }

  function renderSignals() {
    const signals=safeList(snapshot?.signals).slice().sort((a,b)=>(dateValue(b.decision_at)||0)-(dateValue(a.decision_at)||0));
    put('signal-count',signals.length);
    if (!signals.length) {const empty=node('div',undefined,'empty-state compact');empty.append(node('strong','No published signals'),node('p','No setup observations are available in this snapshot. The journal populates after confirmed-bar replay.'));$('signals').replaceChildren(empty);return;}
    $('signals').replaceChildren(...signals.map((s,i)=>{
      const details=node('details',undefined,'signal');details.open=i<2;const summary=node('summary');
      const title=node('span',s.setup || 'Setup','signal-title');title.append(node('small',`${s.cohort || 'Unclassified cohort'} · ${s.kind === 'context' ? 'Context observation' : 'Engine observation'}`));
      const when=node('span',`${time(s.decision_at)} ET`,'signal-time');when.append(node('small',readable(s.status || 'OBSERVED')));
      summary.append(node('span',s.side || '—',`side-tag ${s.side==='SHORT'?'short':''}`),title,when);details.append(summary);
      const body=node('div',undefined,'signal-body'), metrics=node('div',undefined,'signal-metrics');
      [['REPLAY ENTRY',number(s.entry)],['ORIGINAL STOP',number(s.stop)],['INITIAL RISK',number(s.risk)],['RISK / DAILY ATR',percent(s.risk_atr)]].forEach(([label,value])=>{const m=node('div');m.append(node('small',label),node('strong',value));metrics.append(m);});body.append(metrics);
      const notes=[`Decision ${time(s.decision_at)} ET; observed ${time(s.observed_at)} ET.`,s.eligibility ? readable(s.eligibility) : 'Historical replay; not a current entry instruction.',s.note,s.exit?.reason ? `Managed exit: ${readable(s.exit.reason)}${finite(s.exit.price)?` at ${number(s.exit.price)}`:''}.` : null].filter(Boolean).join(' ');body.append(node('p',notes,'signal-note'));
      const targets=node('div',undefined,'targets');safeList(s.targets).forEach((t,j)=>{
        const p=t.probability || {}, view=probabilityView(p), row=node('div',undefined,'target-row');
        const price=node('div',number(t.price),'target-price');price.append(node('small',`${t.label || `T${j+1}`} · ${finite(t.rr)?`${number(t.rr)}R`:'R unavailable'}`));
        const ev=node('div',undefined,'target-evidence');ev.append(node('strong',view.headline),node('p',view.event,'event-name'),node('p',view.counts),node('p',`${view.interval} · raw rate ${percent(p.raw_rate)}`));
        if(p.reason)ev.append(node('p',p.reason));
        row.append(price,ev,node('span',readable(t.outcome || 'UNKNOWN'),'target-outcome'));targets.append(row);
      });body.append(targets);
      body.append(node('p','DEVELOPMENT evidence. Intervals describe historical target events; sessions are correlated. These are not calibrated live forecasts.','signal-evidence-note'));
      const probs=safeList(s.targets).map(t=>t.probability).filter(Boolean);
      if(probs.length){const more=node('details',undefined,'probability-detail');more.append(node('summary','Evidence provenance'));const list=node('ul');probs.forEach((p,j)=>{list.append(node('li',`T${j+1}: ${p.cohort_label || s.cohort || 'cohort unavailable'}; ${p.rr_bucket || 'R bucket unavailable'}; training through ${p.training_end || 'unknown'}. ${p.interval_method || 'Interval method unverified'}.`));if(finite(p.estimate))list.append(node('li',`${p.estimate_label || 'Descriptive estimate'}: ${percent(p.estimate)}. This is separate from the raw interval.`));safeList(p.method_notes).forEach(n=>list.append(node('li',n)));});more.append(list);body.append(more);}
      details.append(body);return details;
    }));
  }

  function renderUW() {
    const state=uwHealth(uw);lastUwValid=state.valid;put('uw-status',state.label);$('uw-status').className=`badge ${state.valid?'green':uw?.status==='manual'?'amber':'neutral'}`;put('uw-meta',state.reason);
    const money=v=>finite(v)?`${v<0?'−':''}$${number(Math.abs(v),0)}`:'—';
    const fields=(id,rows)=>$(id).replaceChildren(...rows.map(([label,value])=>{const row=node('div');row.append(node('dt',label),node('dd',value??'—',value===null||value===undefined||value==='—'?'unavailable':''));return row;}));
    fields('gamma-fields',[['Instrument basis',uw?.symbol || '—'],['Regime',uw?.gamma?.regime || '—'],['Net GEX',finite(uw?.gamma?.net_gex)?`${number(uw.gamma.net_gex,0)} ${uw.gamma.units || '(units missing)'}`:'—'],['Zero gamma',number(uw?.gamma?.zero_gamma)],['Call / put wall',`${number(uw?.gamma?.call_wall)} / ${number(uw?.gamma?.put_wall)}`]]);
    fields('flow-fields',[['Net premium',money(uw?.flow?.net_premium)],['Call premium',money(uw?.flow?.call_premium)],['Put premium',money(uw?.flow?.put_premium)],['Observation window',uw?.flow?.window || '—'],['Classification',uw?.flow?.classification || '—']]);
    const dark=safeList(uw?.dark_pool?.levels).map(l=>finite(l)?number(l):finite(l?.price)?number(l.price):null).filter(Boolean);
    fields('other-fields',[['Dark-pool levels',dark.length?dark.join(' · '):'—'],['Max pain',number(uw?.max_pain)],['Expiry scope',uw?.expiry_scope || '—'],['Method',uw?.method || '—'],['Freshness limit',`${finite(uw?.ttl_minutes)?uw.ttl_minutes:15} minutes`]]);
    const notes=[...safeList(uw?.notes),uw?.dark_pool?.note,uw?.symbol==='SPX'?'SPX context is shown in index points and is not projected onto the SPY price ladder.':null].filter(Boolean);$('uw-notes').replaceChildren(...notes.map(n=>node('p',n)));
  }

  function renderEvidence() {
    if(!evidence)return;
    put('evidence-state',readable(evidence.evidence_state || 'DEVELOPMENT'));put('evidence-sessions',finite(evidence.sessions)?evidence.sessions:'—');put('evidence-period',evidence.training_from && evidence.training_to?`${evidence.training_from} → ${evidence.training_to}`:'Unavailable');put('event-definition',evidence.event_definition || 'Event definition unavailable.');
    $('evidence-body').replaceChildren(...safeList(evidence.cohorts).map(c=>{const tr=node('tr'),name=node('td',c.setup || 'Unknown setup');name.append(node('small',c.cohort || 'Unclassified'));const t=c.t1 || {},thin=finite(c.episodes)&&c.episodes<20;tr.append(name,node('td',finite(c.episodes)?c.episodes:'—','numeric'),node('td',finite(c.sessions)?c.sessions:'—','numeric'),node('td',finite(t.hits)&&finite(t.n)?`${t.hits}/${t.n}`:'—','numeric'),node('td',percent(t.rate),`numeric ${thin?'thin':''}`),node('td',interval(t.interval),'numeric'));return tr;}));
    put('evidence-method',typeof evidence.method==='string'?evidence.method:'Historical development sample; original-stop barriers, same-session outcomes.');$('evidence-limitations').replaceChildren(...safeList(evidence.limitations).map(l=>node('li',l)));
  }

  async function fetchJSON(name) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try {const response=await fetch(`data/${name}.json`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Snapshot unavailable');const data=await response.json();if(!data||typeof data!=='object'||data.schema_version!==1)throw new Error('Unsupported data schema');return data;}finally{clearTimeout(timeout);}
  }
  async function refresh() {
    if(fetching)return;fetching=true;
    const results=await Promise.allSettled(['latest','evidence','uw'].map(fetchJSON));
    if(results[0].status==='fulfilled'){const next=results[0].value;if(!snapshot || !(dateValue(next.generated_at)<dateValue(snapshot.generated_at)))snapshot=next;fetchFailed=false;}else fetchFailed=true;
    if(results[1].status==='fulfilled')evidence=results[1].value;
    if(results[2].status==='fulfilled')uw=results[2].value;
    renderUW();renderMarket();renderEvidence();fetching=false;
  }
  $('toggle-levels').addEventListener('change',renderChart);$('toggle-ribbon').addEventListener('change',renderChart);
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderChart,120);});
  renderUW();updateHealth();refresh();setInterval(updateHealth,15000);setInterval(()=>{if(!document.hidden)refresh();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateHealth();refresh();}});
}
