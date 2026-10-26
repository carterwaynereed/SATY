// Print the structure read for a taped session. Watch context only.
import {readFile} from 'node:fs/promises';
import {readStructure} from '../lib/market-reader.mjs';

const file = process.argv[2] ?? new URL('../market_reader/history/2026-10-26.json', import.meta.url);
const tape = JSON.parse(await readFile(file, 'utf8'));
const read = readStructure(tape);
console.log(JSON.stringify({
  version: read.version,
  session_date: read.session_date,
  symbol: read.symbol,
  live_entry: read.live_entry,
  morning: read.morning,
  now: read.now,
  a_plus_context: read.a_plus_context,
  a_plus_now: read.a_plus_now,
  runners: read.runners,
  grind: read.grind,
  vix: read.vix,
  rules: read.rules.map(rule => ({id: rule.id, active: rule.active, path: rule.path})),
  discord: read.discord,
}, null, 2));
