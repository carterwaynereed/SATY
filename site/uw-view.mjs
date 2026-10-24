// Display-only normalization. Provider context never participates in signals.
// A selected ticker's prices are never borrowed from another ticker or scaled.
const KEYS = ['call_wall', 'put_wall', 'gamma_flip', 'market_tide', 'net_premium', 'max_pain'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 240) : null;
const number = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const compactMoney = value => `${value < 0 ? '−' : ''}$${new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:2}).format(Math.abs(value))}`;
const unavailable = (reason, scope, unit) => ({value:null, asof:null, source:null, state:'UNAVAILABLE', scope, unit, reason});

function field(value, parents, {now, scope, unit, positive = false, string = false}) {
  const object = record(value) ? value : null;
  const raw = object ? object.value ?? object.spot : value;
  const parsed = string ? text(raw) : number(raw);
  if (parsed === null || parsed === '' || (positive && parsed <= 0)) return unavailable('No value supplied by the feed.', scope, unit);
  const metadata = [object, ...parents].filter(record);
  const read = key => metadata.find(item => item[key] !== undefined && item[key] !== null)?.[key];
  const suppliedSymbol = read('symbol') ?? read('ticker');
  if (scope !== 'market-wide' && suppliedSymbol && suppliedSymbol !== scope) return unavailable('Observation instrument differs from the selected ticker.', scope, unit);
  const status = String(read('status') ?? '').toLowerCase();
  if (['placeholder', 'unconfigured', 'not_connected'].includes(status)) return unavailable('No connected observation has been supplied.', scope, unit);
  const observation = metadata.find(item => item.asof !== undefined && item.asof !== null || item.timestamp !== undefined && item.timestamp !== null);
  const asof = date(observation?.asof ?? observation?.timestamp);
  const source = text(read('source'));
  if (!asof || !source) return unavailable('Source or observation time is missing.', scope, unit);
  const age = now - Date.parse(asof);
  if (!Number.isFinite(now) || age < -90000) return unavailable('Observation time cannot be verified.', scope, unit);
  const requestedTTL = number(read('ttl_minutes'));
  const ttl = requestedTTL !== null && requestedTTL > 0 ? Math.min(requestedTTL, 60) : 15;
  const stale = age > ttl * 60000 || ['stale', 'error', 'failed', 'unavailable', 'data hold'].includes(status);
  return {value:parsed, asof, source, state:stale ? 'STALE' : 'CURRENT', scope, unit,
    reason:stale ? 'Dated reference; no current observation is confirmed.' : 'Timestamped display-only context.'};
}

function tideValue(raw) {
  if (typeof raw === 'string') return raw;
  if (!record(raw)) return null;
  if (text(raw.summary) || text(raw.label)) return {...raw, value:text(raw.summary) || text(raw.label)};
  if (typeof raw.value === 'string') return raw;
  const calls = number(raw.net_call_premium), puts = number(raw.net_put_premium);
  if (calls === null && puts === null) return null;
  // Describe the two reported measures without inventing a sentiment classifier.
  return {...raw, value:`Calls ${calls === null ? 'unavailable' : compactMoney(calls)} · Puts ${puts === null ? 'unavailable' : compactMoney(puts)}`};
}

export function normalizeUW(raw, {symbol = 'SPY', now = Date.now()} = {}) {
  const root = record(raw) ? raw : {};
  const requested = ['SPY', 'SPX', 'AAPL', 'GOOGL'].includes(symbol) ? symbol : null;
  const candidate = requested && record(root.by_symbol) ? root.by_symbol[requested] : root;
  // A by_symbol key supplies the instrument only when a conflicting symbol is absent.
  const matched = record(candidate) && requested && (candidate.symbol === requested ||
    (record(root.by_symbol) && !candidate.symbol && candidate === root.by_symbol[requested]));
  const row = matched ? candidate : {};
  const fallback = {source:root.source, asof:root.asof, timestamp:root.timestamp, status:root.status, ttl_minutes:root.ttl_minutes};
  const gamma = record(row.gamma) ? row.gamma : {}, flow = record(row.flow) ? row.flow : {};
  const make = (value, section, unit = 'price', positive = true) => field(value, [section, row, fallback], {now, scope:requested ?? 'unknown', unit, positive});
  const fields = {
    call_wall:make(gamma.call_wall, gamma), put_wall:make(gamma.put_wall, gamma),
    gamma_flip:make(gamma.zero_gamma ?? gamma.gamma_flip ?? gamma.flip, gamma),
    net_premium:make(flow.net_premium, flow, 'USD', false),
    max_pain:make(row.max_pain, row),
  };
  const tide = root.market_tide;
  const tideScope = record(tide) ? text(tide.scope)?.toLowerCase() : null;
  const tickerTide = record(tide) && (tide.symbol || tide.ticker ||
    (tideScope && !['market', 'market-wide', 'market wide', 'all', 'us market'].includes(tideScope)));
  fields.market_tide = tickerTide ? unavailable('A ticker or ETF tide is not market-wide tide.', 'market-wide', 'summary') :
    field(tideValue(tide), [fallback], {now, scope:'market-wide', unit:'summary', string:true});
  const missing = KEYS.filter(key => fields[key].state === 'UNAVAILABLE');
  const stale = KEYS.filter(key => fields[key].state === 'STALE');
  const current = KEYS.filter(key => fields[key].state === 'CURRENT');
  const state = current.length === KEYS.length ? 'CURRENT' : current.length ? 'PARTIAL' : stale.length ? 'STALE' : 'UNAVAILABLE';
  const stamps = Object.values(fields).map(item => item.asof).filter(Boolean).sort((a,b) => Date.parse(a) - Date.parse(b));
  return {state, symbol:requested ?? symbol, source:text(row.source) || text(root.source) || 'Unusual Whales',
    asof:stamps[0] ?? null, values:Object.fromEntries(KEYS.map(key => [key, fields[key].value])), fields,
    missing, stale, current, display_only:true,
    reason:state === 'UNAVAILABLE' ? 'Awaiting timestamped Unusual Whales context. Missing values are unavailable, not zero.' :
      state === 'STALE' ? 'Dated reference only; current context is unavailable.' :
      state === 'PARTIAL' ? `${current.length} of ${KEYS.length} fields current; each field keeps its own time and scope.` :
      'Current display-only context. These values do not change the momentum signal.'};
}

const east = value => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', weekday:'short'}).formatToParts(value).map(p => [p.type,p.value]));
const dayOf = value => {const p=east(value);return `${p.year}-${p.month}-${p.day}`;};

// Informational EOD context only. Neither the signal budget nor an outcome
// statistic consumes this view; the supplied replay summary is not a forecast.
export function maxPainLean(raw, {symbol='SPY', snapshot=null, now=Date.now(), failed=false}={}) {
  const hidden = {visible:false, text:'', evidence:''};
  if (failed || symbol !== 'SPY' || !Number.isFinite(now) || snapshot?.market?.symbol !== 'SPY') return hidden;
  const session=snapshot.session, open=Date.parse(session?.open), close=Date.parse(session?.close), day=dayOf(now);
  const price=number(snapshot.market.last), priceAt=Date.parse(snapshot.health?.price_asof);
  if (['Sat','Sun'].includes(east(now).weekday) || session?.date!==day || session?.calendar_date!==day || session?.status!=='OPEN' ||
      !Number.isFinite(open) || !Number.isFinite(close) || close<=open || dayOf(open)!==day || dayOf(close)!==day ||
      now<open || now<close-600000 || now>=close || snapshot.health?.state!=='CURRENT' || price===null || price<=0 ||
      !Number.isFinite(priceAt) || priceAt<open || now-priceAt<0 || now-priceAt>225000) return hidden;
  const current = item => item?.state==='CURRENT' && item.scope==='SPY' && Number.isFinite(Date.parse(item.asof)) &&
    dayOf(Date.parse(item.asof))===day && now-Date.parse(item.asof)>=0 && now-Date.parse(item.asof)<=300000;
  const view=normalizeUW(raw,{symbol:'SPY',now}), pain=view.fields.max_pain, premium=view.fields.net_premium;
  if (!current(pain) || !current(premium) || premium.value===0 || pain.value===price) return hidden;
  const root=record(raw)?raw:{}, row=record(root.by_symbol)?root.by_symbol.SPY:root;
  if (!record(row)) return hidden;
  const flow=record(row.flow)?row.flow:{}, fallback={source:root.source,asof:root.asof,timestamp:root.timestamp,status:root.status,ttl_minutes:root.ttl_minutes};
  const make=(value,string=false)=>field(value,[flow,row,fallback],{now,scope:'SPY',unit:string?'direction':'USD',string});
  const classification=make(flow.classification,true);
  const label=current(classification)?classification.value.toLowerCase():null;
  let direction=label==='bullish'?1:label==='bearish'?-1:0;
  const calls=make(flow.net_call_premium),puts=make(flow.net_put_premium);
  if (flow.net_premium_basis==='net_call_minus_net_put' && current(calls) && current(puts)) {
    const difference=calls.value-puts.value, consistent=Math.abs(premium.value-difference)<=Math.max(0.01,Math.abs(difference)*1e-9);
    const pairDirection=consistent?Math.sign(difference):0;
    if (!pairDirection || direction && direction!==pairDirection) return hidden;
    direction=pairDirection;
  }
  if (!direction || direction!==Math.sign(pain.value-price)) return hidden;
  const target=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(pain.value);
  return {visible:true, target:pain.value, direction, display_only:true,
    text:`Last-10-min max-pain lean: toward $${target}, net premium agrees, ~60% historically (n=128)`,
    evidence:'SPY display-only context. Carter-reported replay: approximately 60%, n=128; not independently reproduced or a live win probability. This is not a new signal or an order.'};
}
