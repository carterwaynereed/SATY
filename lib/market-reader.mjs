// Structure context for confirmed RTH facts. Signal-only: never a live entry.
// Missing fields stay missing. This module does not synthesize candles.

export const READER_VERSION = 'market-reader-1';
export const LOW_VIX = 16;
const NEAR_ATR = 0.15;
const BOX_ATR = 0.1;
const LADDER = ['-100','-78.6','-61.8','-50','-38.2','-23.6','0','+23.6','+38.2','+50','+61.8','+78.6','+100'];
const RATIOS = {'-100':-1,'-78.6':-.786,'-61.8':-.618,'-50':-.5,'-38.2':-.382,'-23.6':-.236,'0':0,'+23.6':.236,'+38.2':.382,'+50':.5,'+61.8':.618,'+78.6':.786,'+100':1};

const finite = value => typeof value === 'number' && Number.isFinite(value);
const etf = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function etHm(time){
  const ms = typeof time === 'number' ? time : Date.parse(time);
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(etf.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return `${p.hour}:${p.minute}`;
}
function hmOf(bar){return typeof bar?.hm === 'string' ? bar.hm : etHm(bar?.time);}
function isRth(bar){
  if (!bar || bar.session === 'premarket' || bar.session === 'eth' || bar.session === 'hourly') return false;
  const hm = hmOf(bar);
  return typeof hm === 'string' && hm >= '09:30' && hm < '16:00';
}
function round(value, digits = 2){return finite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;}
function rank(label){return LADDER.indexOf(label);}
function ordered(points){
  if (!Array.isArray(points)) return [];
  if (points.every(point => typeof point?.at === 'string' && point.at)) return [...points].sort((a,b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  return points.filter(Boolean);
}

export function atrScale(facts = {}){
  const anchors = facts.anchors ?? {};
  let atr = facts.atr, prev = facts.prev_close;
  if (!(atr > 0) && finite(anchors['+100']) && finite(anchors['+23.6'])) {
    atr = (anchors['+100'] - anchors['+23.6']) / (1 - 0.236);
    prev = anchors['+100'] - atr;
  } else if (!(atr > 0) && finite(anchors['-100']) && finite(anchors['-23.6'])) {
    atr = (anchors['-23.6'] - anchors['-100']) / (1 - 0.236);
    prev = anchors['-100'] + atr;
  }
  const levels = {};
  if (finite(prev) && atr > 0) for (const [label, ratio] of Object.entries(RATIOS)) levels[label] = prev + ratio * atr;
  Object.assign(levels, facts.levels ?? {}, anchors);
  return {atr: atr > 0 ? atr : null, prev: finite(prev) ? prev : null, levels};
}

function nearest(price, levels, atr){
  if (!finite(price)) return null;
  let best = null;
  for (const label of LADDER) {
    const level = levels[label];
    if (!finite(level)) continue;
    const distance = Math.abs(price - level);
    if (!best || distance < best.distance) best = {label, level, distance, atr: atr > 0 ? distance / atr : null};
  }
  return best;
}
function pointLevel(point, levels, atr){
  if (point?.level && finite(levels[point.level])) return {label: point.level, level: levels[point.level], distance: Math.abs(point.price - levels[point.level]), atr: atr > 0 ? Math.abs(point.price - levels[point.level]) / atr : null};
  return nearest(point?.price, levels, atr);
}
function nearEnough(hit, atr){return !!hit && finite(hit.atr) && hit.atr <= (atr > 0 ? NEAR_ATR : Infinity);}

function sequence(points, levels, atr){
  const rows = ordered(points).filter(point => finite(point.price));
  const described = rows.map(point => ({...point, hit: pointLevel(point, levels, atr)}));
  const rising = described.length >= 2 && described.every((point, index) => index === 0 || point.price > described[index - 1].price);
  const ranks = described.map(point => rank(point.hit?.label));
  const ranked = ranks.every(value => value >= 0);
  const nonDecreasing = ranked && ranks.every((value, index) => index === 0 || value >= ranks[index - 1]);
  const onGrid = described.every(point => nearEnough(point.hit, atr));
  return {rows: described, rising, nonDecreasing, onGrid, stepped: ranked && ranks.at(-1) > ranks[0]};
}

export function measureBars(bars, hints = {}){
  const list = Array.isArray(bars) ? bars : [];
  const ignored = list.filter(bar => !isRth(bar)).length;
  const rth = list.filter(isRth);
  const {atr, prev, levels} = atrScale(hints);
  if (!rth.length || !(atr > 0)) return {rth_bars: rth.length, premarket_ignored: ignored, volume_evaluated: false};
  const at = bar => hmOf(bar);
  const highBar = rth.reduce((best, bar) => bar.high > best.high ? bar : best, rth[0]);
  const lowBar = rth.reduce((best, bar) => bar.low < best.low ? bar : best, rth[0]);
  const morning = rth.filter(bar => at(bar) < '11:30');
  const swings = (rows, key) => rows.flatMap((bar, index) => {
    if (index === 0 || index === rows.length - 1 || !finite(bar[key])) return [];
    const prevBar = rows[index - 1], nextBar = rows[index + 1];
    const turn = key === 'low' ? bar.low <= prevBar.low && bar.low < nextBar.low : bar.high >= prevBar.high && bar.high > nextBar.high;
    return turn ? [{at: at(bar), price: bar[key]}] : [];
  });
  let gg = null, ggAt = null;
  for (const bar of rth) {
    if (at(bar) < '09:35' || !finite(bar.close) || !finite(bar.ema8) || !finite(bar.ema21)) continue;
    const bull = bar.ema8 > bar.ema21 && (bar.ema34 == null || bar.ema21 > bar.ema34);
    const bear = bar.ema8 < bar.ema21 && (bar.ema34 == null || bar.ema21 < bar.ema34);
    if (bull && finite(levels['+38.2']) && bar.close > levels['+38.2']) {gg = '+38.2'; ggAt = at(bar); break;}
    if (bear && finite(levels['-38.2']) && bar.close < levels['-38.2']) {gg = '-38.2'; ggAt = at(bar); break;}
  }
  let triggerHold = null;
  if (gg && ggAt) {
    const level = levels[gg === '+38.2' ? '+23.6' : '-23.6'];
    const held = rth.filter(bar => at(bar) >= ggAt && at(bar) < '11:00' && finite(bar.close));
    if (held.length && finite(level)) triggerHold = gg === '+38.2' ? held.every(bar => bar.close > level) : held.every(bar => bar.close < level);
  }
  const tests = [];
  let open = null;
  for (const bar of rth) {
    if (!finite(bar.close) || !finite(bar.ema8) || !finite(bar.ema21)) {if (open) {tests.push(open); open = null;} continue;}
    const e8 = bar.close < bar.ema8 ? 'lost' : 'held', e21 = bar.close < bar.ema21 ? 'lost' : 'held';
    if (e8 === 'held' && e21 === 'held') {
      if (!tests.length && !open) tests.push({from: at(bar), to: at(bar), e8, e21, price: bar.low});
      if (open) {tests.push(open); open = null;}
      continue;
    }
    if (!open || open.e8 !== e8 || open.e21 !== e21) {
      if (open) tests.push(open);
      open = {from: at(bar), to: at(bar), e8, e21, price: finite(bar.low) ? bar.low : bar.close};
    } else open.to = at(bar);
  }
  if (open) tests.push(open);
  const bucket = (start, end) => rth.filter(bar => at(bar) >= start && at(bar) < end);
  const mean = rows => rows.length && rows.every(bar => finite(bar.volume)) ? rows.reduce((sum, bar) => sum + bar.volume, 0) / rows.length : null;
  const morningVol = mean(bucket('09:30','11:00')), middayVol = mean(bucket('12:00','14:30')), lateVol = mean(bucket('14:30','16:00'));
  const volume = {
    morning: morningVol != null && middayVol != null && morningVol >= 1.25 * middayVol ? 'heavy' : morningVol != null ? 'measured' : null,
    midday: morningVol != null && middayVol != null && middayVol <= 0.75 * morningVol ? 'dry' : middayVol != null ? 'measured' : null,
    late: lateVol != null && middayVol != null && lateVol >= 1.25 * middayVol ? 'surge' : lateVol != null ? 'measured' : null,
  };
  const beforeLate = rth.filter(bar => at(bar) < '14:30');
  const lateBars = bucket('14:30','16:00');
  const priorHigh = beforeLate.reduce((max, bar) => Math.max(max, bar.high), -Infinity);
  const lateHigh = lateBars.reduce((max, bar) => Math.max(max, bar.high), -Infinity);
  volume.late_expanded_atr = lateBars.length && finite(priorHigh) ? lateHigh > priorHigh && rank(nearest(lateHigh, levels, atr)?.label) > rank(nearest(priorHigh, levels, atr)?.label) : null;
  let flips = 0, previous = null;
  for (const bar of bucket('12:00','14:30')) {
    if (!finite(bar.ema8) || !finite(bar.ema21)) continue;
    const bull = bar.ema8 > bar.ema21 && (bar.ema34 == null || bar.ema21 > bar.ema34);
    const bear = bar.ema8 < bar.ema21 && (bar.ema34 == null || bar.ema21 < bar.ema34);
    const stack = bull ? 1 : bear ? -1 : 0;
    if (previous != null && stack !== 0 && stack !== previous) flips += 1;
    if (stack !== 0) previous = stack;
  }
  const afternoonBars = bucket('12:00','15:00');
  return {
    rth_bars: rth.length,
    premarket_ignored: ignored,
    open: rth[0].open,
    high: highBar.high,
    high_at: at(highBar),
    low: lowBar.low,
    low_at: at(lowBar),
    swing_lows: swings(morning, 'low'),
    lids: swings(morning, 'high'),
    ribbon_tests: tests,
    gg_through: gg,
    trigger_hold: triggerHold,
    volume,
    volume_evaluated: true,
    ribbon_flips: flips ? {count: flips, window: '12:00-14:30'} : null,
    afternoon: afternoonBars.length ? {low: Math.min(...afternoonBars.map(bar => bar.low)), high: Math.max(...afternoonBars.map(bar => bar.high))} : null,
  };
}

function resolveTests(tests, facts, scale, side){
  const extensionAt = side > 0 ? facts.high_at : facts.low_at;
  const extension = side > 0 ? '+100' : '-100';
  const shelf = side > 0 ? '+38.2' : '-38.2';
  let pullbacks = 0;
  return ordered(tests).map(test => {
    const hit = test.near && scale.levels[test.near] ? {label: test.near} : pointLevel({price: test.price, level: test.level}, scale.levels, scale.atr);
    const near = test.near || hit?.label || null;
    const after = (extensionAt && test.from >= extensionAt) || near === extension;
    const held = test.e8 === 'lost' && test.e21 === 'held';
    const lost = test.e8 === 'lost' && test.e21 === 'lost';
    let kind = 'context';
    if (test.e8 === 'held' && test.e21 === 'held') kind = 'stack_hold';
    else if (held && !after && near === shelf) kind = 'shallow_continuation';
    else if (held && !after) {pullbacks += 1; kind = pullbacks === 1 ? 'first_pullback' : 'later_pullback';}
    else if ((held || lost) && after) kind = 'skip_after_extension';
    else if (lost) kind = 'trend_done';
    return {...test, near, kind, keep: kind === 'first_pullback'};
  });
}

function boxed(facts, scale, side){
  const range = facts.afternoon;
  if (!range || !finite(range.low) || !finite(range.high) || !(scale.atr > 0)) return false;
  const inner = scale.levels[side > 0 ? '+61.8' : '-61.8'];
  const outer = scale.levels[side > 0 ? '+100' : '-100'];
  if (!finite(inner) || !finite(outer)) return false;
  const tol = BOX_ATR * scale.atr;
  const [low, high] = side > 0 ? [range.low, range.high] : [range.high, range.low];
  return low >= inner - tol && high <= outer + tol && high >= inner;
}

function applyDiscord(facts, state){
  const applied = [];
  for (const call of facts.discord?.calls ?? []) {
    const text = String(call?.paraphrase ?? '');
    const lowered = text.toLowerCase();
    const use = (lowered.includes('triangle') && state.triangle)
      || ((lowered.includes('gg') || lowered.includes('golden')) && state.gap)
      || ((lowered.includes('7700') || lowered.includes('h200')) && state.first)
      || ((lowered.includes('scalp') || lowered.includes('afternoon')) && state.box)
      || (lowered.includes('21') && facts.ten_minute_21_lost === true)
      || (lowered.includes('vix'))
      || ((lowered.includes('10m') || lowered.includes('trigger') || lowered.includes('choppy')) && state.gap);
    if (use) applied.push({at: call.at ?? null, paraphrase: text});
  }
  return applied;
}

export function readStructure(input = {}){
  const tape = input.tape ?? input;
  const measured = Array.isArray(input.bars) || Array.isArray(tape.bars) ? measureBars(input.bars ?? tape.bars, tape) : null;
  const facts = measured ? {
    ...tape,
    ...measured,
    vix: tape.vix ?? null,
    vixy_rising: tape.vixy_rising ?? null,
    ten_minute_hold: tape.ten_minute_hold ?? null,
    ten_minute_21_lost: tape.ten_minute_21_lost ?? null,
    discord: tape.discord ?? null,
    anchors: tape.anchors,
    levels: tape.levels,
    prev_close: tape.prev_close,
    atr: tape.atr,
    swing_lows: measured.swing_lows?.length ? measured.swing_lows : tape.swing_lows,
    lids: measured.lids?.length ? measured.lids : tape.lids,
    ribbon_tests: measured.ribbon_tests?.length ? measured.ribbon_tests : tape.ribbon_tests,
    volume: measured.volume_evaluated ? measured.volume : tape.volume,
    ribbon_flips: measured.ribbon_flips ?? tape.ribbon_flips ?? null,
    afternoon: measured.afternoon ?? tape.afternoon ?? null,
  } : {...tape};
  const scale = atrScale(facts);
  const open = facts.open, triggerUp = scale.levels['+23.6'], triggerDown = scale.levels['-23.6'];
  const side = finite(open) && finite(triggerUp) && open > triggerUp ? 1 : finite(open) && finite(triggerDown) && open < triggerDown ? -1 : 0;
  const gg = facts.gg_through === '+38.2' ? 1 : facts.gg_through === '-38.2' ? -1 : 0;
  const hold = facts.trigger_hold === true || facts.ten_minute_hold === true;
  const vix = finite(facts.vix) ? facts.vix : null;
  const lowVix = vix != null && vix < LOW_VIX;
  const vixyRising = facts.vixy_rising === true;
  const vixVeto = vixyRising && vix != null && vix >= LOW_VIX;
  const gap = side !== 0 && gg === side && hold && !vixVeto;
  const extensionAt = side >= 0 ? facts.high_at ?? null : facts.low_at ?? null;
  const extreme = side >= 0 ? facts.high : facts.low;
  const extensionLabel = side >= 0 ? '+100' : side < 0 ? '-100' : null;
  const tagged = side !== 0 && finite(extreme) && finite(scale.levels[extensionLabel]) && (side > 0 ? extreme >= scale.levels[extensionLabel] : extreme <= scale.levels[extensionLabel]);
  const tests = resolveTests(facts.ribbon_tests, {...facts, high_at: extensionAt, low_at: extensionAt}, scale, side || 1);
  const lows = sequence(facts.swing_lows, scale.levels, scale.atr);
  const lidSeq = sequence(facts.lids, scale.levels, scale.atr);
  const lastLid = lidSeq.rows.at(-1)?.hit?.label;
  const nextLid = lastLid ? LADDER[rank(lastLid) + (side >= 0 ? 1 : -1)] : null;
  const expanded = side !== 0 && nextLid && finite(extreme) && finite(scale.levels[nextLid]) && (side > 0 ? extreme >= scale.levels[nextLid] : extreme <= scale.levels[nextLid]);
  const triangle = lows.rows.length >= 3 && lows.rising && lows.nonDecreasing && lows.onGrid && lidSeq.rows.length >= 2 && lidSeq.nonDecreasing && lidSeq.onGrid && (lows.stepped || lidSeq.stepped) && expanded;
  const first = tests.some(test => test.kind === 'first_pullback');
  const skipped = tests.some(test => test.kind === 'skip_after_extension');
  const box = side !== 0 && boxed({...facts, afternoon: facts.afternoon}, scale, side);
  const dry = facts.volume?.midday === 'dry';
  const rule3 = dry && box;
  const runnersStopped = facts.ten_minute_21_lost === true;
  const rule4 = skipped || (tagged && runnersStopped);
  const morningBias = gap;
  const sitNow = rule3 || rule4 || runnersStopped || !morningBias;
  const grindSide = morningBias && (!extensionAt || extensionAt > '10:30') ? (side > 0 ? 'UP' : 'DOWN') : 'NONE';
  const rules = [
    {id:'gap-gg-hold', active: morningBias, situation:'Gap beyond the 23.6 trigger, Golden Gate through 38.2, and the 10m or trigger still holding', path: side < 0 ? 'Morning short bias. Choppy is allowed. Not an order.' : 'Morning long bias. Choppy is allowed. Not an order.', role:'context'},
    {id:'triangle-first-pullback', active: triangle && first && morningBias, situation:'Ascending triangle: higher lows into an ATR lid, then the first ribbon hold', path:'Take the first pullback only. A shallow 8-EMA dip that holds the 21 is continuation, not a second entry.', role:'context'},
    {id:'dry-box', active: rule3, situation:'Dry volume while price boxes between two ATR levels', path:'Sit. Ribbon flips inside that box are context only.', role:'context'},
    {id:'second-test-after-extension', active: rule4, situation:'Another ribbon test after the 100 level is tagged, or after the 10m 21 is lost', path:'Skip. Runners stop. This is not a new live entry.', role:'context'},
  ];
  const discord = applyDiscord(facts, {triangle, gap: morningBias, first, box});
  const gapAtr = finite(open) && finite(scale.prev) && scale.atr > 0 ? (open - scale.prev) / scale.atr : null;
  return {
    version: READER_VERSION,
    live_entry: false,
    session_basis: 'RTH',
    premarket_excluded: true,
    session_date: facts.session_date ?? null,
    symbol: facts.symbol ?? null,
    morning: {posture: morningBias ? (side > 0 ? 'LONG_BIAS' : 'SHORT_BIAS') : 'SIT', reason: morningBias ? 'Gap, Golden Gate, and trigger or 10m hold agree.' : vixVeto ? 'VIX did not confirm the gap.' : 'No stacked gap and Golden Gate hold.'},
    now: {posture: sitNow ? 'SIT' : 'WATCH', reason: rule3 ? 'Dry box between ATR levels.' : rule4 ? 'Extension or a later ribbon test already passed.' : runnersStopped ? '10m 21 loss stopped runners.' : morningBias ? 'Morning context is still the active read.' : 'Nothing stacked.'},
    a_plus_context: rules[0].active && rules[1].active,
    a_plus_window: rules[0].active && rules[1].active ? 'morning' : null,
    a_plus_now: rules[0].active && rules[1].active && !rule3 && !rule4 && !runnersStopped,
    runners: runnersStopped ? 'stopped' : 'not_signaled',
    ribbon_flips: 'context-only',
    vix: {absolute: vix, vixy_rising: facts.vixy_rising ?? null, confirms: lowVix, veto: vixVeto, vetoed_by_vixy_alone: false, role: 'confirmation'},
    grind: {at: '10:30', side: grindSide, watch_only: true, logged: true, live_entry: false, forward_test: true, reason: grindSide === 'NONE' ? 'No morning hold was still open at 10:30.' : 'Soft lean with the morning hold. Watch only.'},
    structures: {
      trend: {side, gap_atr: round(gapAtr, 2), open: finite(open) ? open : null, trigger: side < 0 ? triggerDown : triggerUp, extension: extensionLabel, extension_tagged: tagged, extension_at: extensionAt, afternoon_box: box},
      triangle: {active: triangle, lows: lows.rows.map(point => point.price), lids: lidSeq.rows.map(point => point.hit?.label ?? null)},
      ribbon_tests: tests,
      volume: {morning: facts.volume?.morning ?? null, midday: facts.volume?.midday ?? null, late: facts.volume?.late ?? null, late_expanded_atr: facts.volume?.late_expanded_atr ?? null},
      price_action: rules.filter(rule => rule.active).map(rule => `${rule.situation} → ${rule.path}`),
    },
    rules,
    discord,
  };
}
