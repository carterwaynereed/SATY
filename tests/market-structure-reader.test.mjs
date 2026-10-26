import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readStructure} from '../lib/market-reader.mjs';

const tape = JSON.parse(await readFile(new URL('../market_reader/history/2026-10-26.json', import.meta.url), 'utf8'));
const rule = (read, id) => read.rules.find(item => item.id === id);

test('Oct 26 tape reads trend, triangle, ribbon, volume and price action against ATR', () => {
  const read = readStructure(tape);
  assert.equal(read.live_entry, false);
  assert.equal(read.premarket_excluded, true);
  assert.equal(read.morning.posture, 'LONG_BIAS');
  assert.equal(read.now.posture, 'SIT');
  assert.equal(read.a_plus_context, true);
  assert.equal(read.a_plus_window, 'morning');
  assert.equal(read.a_plus_now, false);
  assert.equal(read.structures.trend.gap_atr, 0.32);
  assert.equal(read.structures.trend.extension_tagged, true);
  assert.equal(read.structures.trend.afternoon_box, true);
  assert.equal(read.structures.triangle.active, true);
  assert.deepEqual(read.structures.triangle.lids, ['+61.8', '+61.8', '+78.6']);
  assert.equal(read.structures.volume.morning, 'heavy');
  assert.equal(read.structures.volume.midday, 'dry');
  assert.equal(read.structures.volume.late_expanded_atr, false);
  assert.equal(read.structures.ribbon_tests.find(item => item.from === '09:57').kind, 'shallow_continuation');
  assert.equal(read.structures.ribbon_tests.find(item => item.from === '10:24').kind, 'first_pullback');
  assert.equal(read.structures.ribbon_tests.find(item => item.from === '11:12').kind, 'skip_after_extension');
  assert.equal(read.structures.ribbon_tests.find(item => item.from === '11:24').kind, 'skip_after_extension');
  assert.equal(rule(read, 'gap-gg-hold').active, true);
  assert.equal(rule(read, 'triangle-first-pullback').active, true);
  assert.equal(rule(read, 'dry-box').active, true);
  assert.equal(rule(read, 'second-test-after-extension').active, true);
  assert.equal(read.structures.price_action.length, 4);
  assert.equal(read.ribbon_flips, 'context-only');
  assert.equal(read.runners, 'stopped');
  assert.ok(read.rules.every(item => item.role === 'context'));
});

test('Oct 26 Discord paraphrase attaches as context and does not become an entry', () => {
  assert.equal(tape.discord_fold.scrape_present, false);
  const read = readStructure(tape);
  const lines = read.discord.map(call => call.paraphrase);
  assert.ok(lines.some(line => /ascending triangle/.test(line)));
  assert.ok(lines.some(line => /7700\/H200/.test(line)));
  assert.ok(lines.some(line => /scalp box/.test(line)));
  assert.ok(lines.some(line => /21 loss/.test(line)));
  assert.ok(lines.some(line => /VIX is confirmation/.test(line)));
  assert.equal(read.live_entry, false);
  assert.equal(read.vix.confirms, true);
  assert.equal(read.vix.vetoed_by_vixy_alone, false);
});

test('grind lean is logged at 10:30 and stays watch-only', () => {
  const read = readStructure(tape);
  assert.equal(read.grind.at, '10:30');
  assert.equal(read.grind.side, 'UP');
  assert.equal(read.grind.logged, true);
  assert.equal(read.grind.watch_only, true);
  assert.equal(read.grind.forward_test, true);
  assert.equal(read.grind.live_entry, false);
});

function heldMorning(extra){
  return readStructure({prev_close:100, atr:10, open:103, high:106, high_at:'10:50', gg_through:'+38.2', trigger_hold:true, ten_minute_hold:true, ...extra});
}

test('VIXY rising does not sit a held gap when absolute VIX is low', () => {
  const read = heldMorning({vix:14, vixy_rising:true, inside_pm_range:true, rvol:0.79});
  assert.equal(read.morning.posture, 'LONG_BIAS');
  assert.equal(read.vix.veto, false);
  assert.equal(read.vix.vetoed_by_vixy_alone, false);
  assert.equal(read.live_entry, false);
  assert.equal(read.a_plus_context, false);
});

test('VIX at 16 or higher with VIXY rising removes the morning bias', () => {
  const read = heldMorning({vix:16, vixy_rising:true});
  assert.equal(read.morning.posture, 'SIT');
  assert.equal(read.vix.veto, true);
  assert.equal(read.vix.confirms, false);
});

test('unknown VIX does not confirm and does not veto by itself', () => {
  const read = heldMorning({vixy_rising:true});
  assert.equal(read.vix.absolute, null);
  assert.equal(read.vix.confirms, false);
  assert.equal(read.vix.veto, false);
  assert.equal(read.morning.posture, 'LONG_BIAS');
});

test('a short gap mirrors the morning read', () => {
  const read = readStructure({prev_close:100, atr:10, open:97, low:94, low_at:'10:50', gg_through:'-38.2', trigger_hold:true, vix:14});
  assert.equal(read.morning.posture, 'SHORT_BIAS');
  assert.equal(read.grind.side, 'DOWN');
  assert.equal(read.live_entry, false);
});

test('gap and Golden Gate without a hold stay a sit', () => {
  const read = readStructure({prev_close:100, atr:10, open:103, gg_through:'+38.2', trigger_hold:false, ten_minute_hold:false});
  assert.equal(read.morning.posture, 'SIT');
  assert.equal(rule(read, 'gap-gg-hold').active, false);
});

test('empty input logs a sit and invents no bias', () => {
  const read = readStructure({});
  assert.equal(read.morning.posture, 'SIT');
  assert.equal(read.grind.side, 'NONE');
  assert.equal(read.grind.logged, true);
  assert.equal(read.structures.volume.midday, null);
  assert.equal(read.live_entry, false);
});

test('premarket bars stay out of the RTH read', () => {
  const read = readStructure({
    prev_close:100,
    atr:10,
    bars:[{hm:'08:15', session:'premarket', open:110, high:112, low:90, close:111, ema8:80, ema21:70, ema34:60, volume:50}],
  });
  assert.equal(read.morning.posture, 'SIT');
  assert.equal(read.structures.trend.open, null);
});

test('confirmed bars can show a first pullback and a later skip without invented volume', () => {
  const bar = (hm, open, high, low, close, ema8, ema21, volume) => ({hm, open, high, low, close, ema8, ema21, ema34:ema21 - 1, volume});
  const bars = [
    {hm:'08:00', session:'premarket', open:120, high:121, low:80, close:120, ema8:70, ema21:60, ema34:50, volume:9},
    bar('09:36', 104, 104.6, 103.9, 104.3, 103.4, 102.8, null),
    bar('09:42', 106.2, 106.6, 105.2, 105.4, 105.8, 104.6, null),
    bar('09:45', 105.4, 110.2, 105.5, 110, 108, 106, null),
    bar('09:48', 110, 110.1, 108.4, 108.8, 109.4, 107.2, null),
  ];
  const read = readStructure({prev_close:100, atr:10, bars});
  assert.equal(read.morning.posture, 'LONG_BIAS');
  assert.equal(read.structures.ribbon_tests.find(item => item.from === '09:42').kind, 'first_pullback');
  assert.equal(read.structures.ribbon_tests.find(item => item.from === '09:48').kind, 'skip_after_extension');
  assert.equal(read.structures.volume.midday, null);
  assert.equal(rule(read, 'dry-box').active, false);
  assert.equal(read.grind.side, 'NONE');
  assert.equal(read.live_entry, false);
});
