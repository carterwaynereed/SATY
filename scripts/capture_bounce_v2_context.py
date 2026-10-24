#!/usr/bin/env python3
"""Hidden native 5m VIX / 1H ticker context, existing scheduler only."""
import argparse
import asyncio
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from refresh_tv_market import tvdata, frame_from_values, json_bars, source_identity, SYMBOLS
ROOT = Path(__file__).resolve().parents[1]

def expected_close(calendar, minutes, now):
    latest = None
    for s in calendar['sessions'].values():
        t, end = datetime.fromisoformat(s['open']), datetime.fromisoformat(s['close'])
        if t > now:
            continue
        while t < end:
            close = min(t + timedelta(minutes=minutes), end)
            if close <= now and (latest is None or close > latest):
                latest = close
            t += timedelta(minutes=minutes)
    return latest

async def collect(state, clock=None, pull=None):
    pull = pull or tvdata._get
    now = clock or datetime.now(timezone.utc)
    day = now.astimezone(ZoneInfo('America/New_York')).date().isoformat()
    calendar = json.loads((ROOT / 'hosting/session-calendar.json').read_text())
    if day not in calendar['sessions']:
        print(json.dumps({'shadow_v2_context': day, 'skipped': 'No exchange session'}))
        return
    directory = state / 'level-bounce-v2/context'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (day+'.json')
    result = json.loads(path.read_text()) if path.exists() else {'day': day, 'series': {}}
    result.update(captured_at=now.isoformat(), errors=[])
    semaphore = asyncio.Semaphore(3)
    async def capture(key, symbols, minutes, count):
        old = result['series'].get(key, {})
        expected = expected_close(calendar, minutes, now)
        if expected and old.get('latest_confirmed_at') == expected.isoformat():
            return
        async with semaphore:
            for symbol in symbols:
                try:
                    raw = await asyncio.wait_for(pull(symbol, str(minutes), count, 'regular', 10), 14)
                    meta = dict(tvdata.META.get(symbol, {}))
                    source = source_identity(symbol, meta)
                    if not source.get('source_id'):
                        raise ValueError('Missing provider identity')
                    if old.get('source') and old['source'].get('source_id') != source['source_id']:
                        raise ValueError('Research source changed within session')
                    frame, volume = frame_from_values(raw)
                    delay = max(0, meta.get('delay') or 0)
                    cutoff = now-timedelta(seconds=delay)
                    bars, latest = [], None
                    for b in json_bars(frame, volume):
                        t = datetime.fromisoformat(b['time'])
                        local = t.astimezone(ZoneInfo('America/New_York'))
                        s = calendar['sessions'].get(local.date().isoformat())
                        if not s:
                            continue
                        opened, closed = datetime.fromisoformat(s['open']), datetime.fromisoformat(s['close'])
                        end = min(t+timedelta(minutes=minutes), closed)
                        if opened <= t < closed and (t-opened).total_seconds() % (minutes*60) == 0 and end <= cutoff:
                            bars.append(b)
                            latest = end
                    if not bars:
                        raise ValueError('No confirmed native interval bars')
                    mapping = {b['time']: b for b in old.get('bars', [])}
                    seen = old.get('first_seen', {})
                    for b in bars:
                        mapping.setdefault(b['time'], b)
                        seen.setdefault(b['time'], now.isoformat())
                    result['series'][key] = {'bars': sorted(mapping.values(), key=lambda b:b['time']), 'first_seen': seen,
                        'latest_confirmed_at': latest.isoformat(), 'source': {**source, 'interval': str(minutes)+'m'}, 'captured_at': now.isoformat()}
                    return
                except Exception as exc:
                    error = str(exc)
            result['errors'].append({'series': key, 'reason': 'DATA HOLD: '+error})
    await asyncio.gather(capture('VIX5', ['CBOE:VIX'], 5, 1500), *[capture(s, SYMBOLS[s], 60, 500) for s in SYMBOLS])
    path.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False)+'\n')
    print(json.dumps({'shadow_v2_context': day, 'series_n': len(result['series']), 'errors_n': len(result['errors'])}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, required=True)
    asyncio.run(collect(parser.parse_args().state_dir))
