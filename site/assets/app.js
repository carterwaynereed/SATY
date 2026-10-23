/* Buildless UI. External values enter the DOM only through textContent. */
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const number = (value, digits = 2) => finite(value) ? value.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
export const percent = value => finite(value) ? `${Math.round(value * 100)}%` : '—';

/* Conditional market reads retain the last parsed bundle only after a valid 200 response. */
export function createMarketReader(fetcher = fetch) {
  let previous = null, etag = null, previousURL = null;
  return async function readMarket(url, {sameOrigin = false, timeout = 30000} = {}) {
    if (url !== previousURL) { previous = null; etag = null; previousURL = url; }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = sameOrigin && etag ? {'If-None-Match':etag} : {};
      const response = await fetcher(url,{headers,credentials:sameOrigin?'same-origin':'omit',cache:'no-store',signal:controller.signal});
      if (response.status === 304) {
        if (!sameOrigin || !previous) throw new Error('Market returned 304 without a prior same-origin snapshot');
        return previous;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!value || value.schema_version !== 2 || !value.symbols || typeof value.symbols !== 'object' || Array.isArray(value.symbols)) throw new Error('Unsupported multi-ticker snapshot');
      previous = value; etag = sameOrigin ? response.headers.get('ETag') : null;
      return value;
    } finally { clearTimeout(timer); }
  };
}
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
  if (h.state === 'UNAVAILABLE') return {state:'DATA HOLD',tone:'hold',reason:h.reason || 'The source did not pass freshness checks.',age};
  const session = snapshot.session || {}, open = dateValue(session.open), close = dateValue(session.close);
  if (h.state === 'OPENING') {
    const hm = new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
    if (session.calendar_date === etDate(now) && hm >= '09:30' && hm < '09:33') return {state:'FIRST BAR FORMING',tone:'closed',reason:'Waiting for the confirmed 09:30–09:33 ET bar. Prior-session indicators are reference only.',age};
    if (hm >= '09:33' && hm < '16:00' && session.calendar_date === etDate(now)) return {state:'DATA HOLD',tone:'hold',reason:'The first confirmed regular-session bar has not arrived.',age};
  }
  if (session.date && session.date !== etDate(now) && age > 43200) return {state:'DATED SNAPSHOT',tone:'closed',reason:`Showing the ${session.date} session. No current-session decision is available.`,age};
  if (Number.isFinite(open) && Number.isFinite(close) && now >= open && now < close) {
    if (h.state === 'STALE') return {state:'STALE SNAPSHOT',tone:'hold',reason:h.reason || 'The expected confirmed bar has not arrived.',age};
    if (age > (finite(h.ttl_seconds) ? h.ttl_seconds : 900)) return {state:'STALE SNAPSHOT',tone:'hold',reason:'The confirmed close is older than the freshness limit. Await the next successful run.',age};
    const live = session.refresh_seconds === 15 || h.live_feed === true;
    return {state:live?'CURRENT BAR':'CURRENT SNAPSHOT',tone:'current',reason:live?'TradingView public chart feed · confirmed 3m bars · page checks every 15 seconds.':`Scheduled ${session.refresh_minutes || 10}-minute updates · confirmed 3m bars · not a live quote.`,age};
  }
  if (session.status === 'OPEN' && !Number.isFinite(close)) return {state:'DATA HOLD',tone:'hold',reason:'Session boundaries are unavailable.',age};
  return {state:session.status === 'PREMARKET' ? 'PREMARKET' : 'SESSION CLOSED',tone:'closed',reason:h.reason || 'Reference snapshot. New entries are not being evaluated.',age};
}

export function uwHealth(uw, now = Date.now()) {
  if (!uw || uw.status !== 'manual') return {valid:false,label:'MANUAL / PLACEHOLDER',reason:'Awaiting a manual snapshot. Missing values are unavailable, not zero.'};
  const ts = dateValue(uw.asof), age = (now - ts) / 60000, ttl = finite(uw.ttl_minutes) && uw.ttl_minutes > 0 ? uw.ttl_minutes : 15;
  if (!Number.isFinite(ts) || age < -1) return {valid:false,label:'MANUAL / UNVERIFIED',reason:'The manual snapshot needs a valid, nonfuture timestamp.'};
  if (age > ttl) return {valid:false,label:'MANUAL / STALE',reason:`Manual snapshot expired ${Math.floor(age - ttl)} minutes ago. Values below are historical context only.`};
  if (!['SPY','SPX','AAPL','GOOGL'].includes(uw.symbol)) return {valid:false,label:'MANUAL / UNVERIFIED',reason:'Set an explicit SPY, SPX, AAPL or GOOGL instrument basis.'};
  if (!uw.method || !uw.expiry_scope) return {valid:false,label:'MANUAL / UNVERIFIED',reason:'Methodology and expiry scope are required before gamma levels join the map.'};
  return {valid:true,label:'MANUAL / CURRENT',reason:`${uw.source || 'Unusual Whales'} · ${uw.symbol} basis · as of ${time(uw.asof)} ET · ${uw.expiry_scope}`};
}

export function probabilityView(probability) {
  const p = probability || {}, n = finite(p.n) ? p.n : null, episodes = finite(p.episodes) ? p.episodes : null;
  const rate = finite(p.display_probability) && p.display_probability >= 0 && p.display_probability <= 1 ? p.display_probability : null;
  const show = n >= 20 && episodes >= 20 && rate !== null;
  return {headline:show ? `${percent(rate)} historical hit rate` : 'Limited evidence · no headline probability',
    counts:finite(p.hits) && n !== null ? `${p.hits}/${n} target events · ${episodes === null ? 'episode count unverified' : `${episodes} episodes`} · ${finite(p.sessions) ? p.sessions : '—'} sessions` : 'No matching historical target events',
    interval:`Wilson 95% interval: ${interval(p.interval)} (n=${n ?? 'unavailable'})`,
    event:p.event || 'Target before original stop by session close',show};
}


export function evidenceMatches(snapshot, evidence) {
  return Boolean(snapshot?.evidence_id && snapshot.evidence_id === evidence?.stats_id && snapshot.strategy?.version === evidence?.strategy_version);
}
export function paperRateView(stats, trades = []) {
  const n = Number.isInteger(stats?.n) && stats.n >= 0 ? stats.n : 0;
  const wins = trades.filter(t => t.status === 'closed' && Number.isFinite(t.r) && t.r > 0).length;
  return {n, wins, headline:n >= 20 && finite(stats?.winRate) ? `${stats.winRate}% observed wins · n=${n}` : `Headline withheld · n=${n} < 20`,
    interval:Array.isArray(stats?.interval) ? `${stats.interval.join('–')}% · n=${n}` : `Unavailable · n=${n}`};
}
export function safeHref(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function manualSPYLevels(uw, now = Date.now()) {
  return manualTickerLevels(uw,'SPY',now);
}
export function manualTickerLevels(uw, symbol, now = Date.now()) {
  if (!uwHealth(uw, now).valid || uw.symbol !== symbol) return [];
  return [['Call wall',uw.gamma?.call_wall],['Put wall',uw.gamma?.put_wall],['Zero gamma',uw.gamma?.zero_gamma]]
    .filter(([,price])=>finite(price)).map(([label,price])=>({label:`${label} · MANUAL`,price,manual:true}));
}
export function validPaperSnapshot(value) {
  if (!value || typeof value !== 'object' || !value.feeds?.symbols || typeof value.feeds.symbols !== 'object' || Array.isArray(value.feeds.symbols) || !Array.isArray(value.journal) || value.journal.length > 10000) return false;
  if (!value.journal.every(t => t && typeof t === 'object' && !Array.isArray(t) && ['SPY','SPX','AAPL','GOOGL'].includes(t.symbol) && typeof t.status === 'string' && t.status.length > 0 && t.status.length <= 40 && (t.r == null || finite(t.r)))) return false;
  return Object.entries(value.feeds.symbols).every(([symbol,feed]) => ['SPY','SPX','AAPL','GOOGL'].includes(symbol) && feed && typeof feed === 'object' && Array.isArray(feed.bars ?? []) && (feed.bars ?? []).length <= 10000);
}
