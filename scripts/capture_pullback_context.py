#!/usr/bin/env python3
"""Two VIX requests per existing capture; overnight capture once per session.
Research-only state: never copied into site/data or mixed into RTH bars.
"""
import argparse
import asyncio
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from refresh_tv_market import tvdata, frame_from_values, json_bars, source_identity, SYMBOLS

async def collect(state):
    now = datetime.now(timezone.utc)
    day = now.astimezone(ZoneInfo('America/New_York')).date().isoformat()
    directory = state / 'pullback-vix' / 'context'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (day + '.json')
    old = json.loads(path.read_text()) if path.exists() else {}
    result = {**old, 'day': day, 'captured_at': now.isoformat(), 'errors': []}
    async def get(symbol, tf, count, session='regular'):
        raw = await asyncio.wait_for(tvdata._get(symbol, tf, count, session, 10), 14)
        identity = source_identity(symbol, dict(tvdata.META.get(symbol, {})))
        if not identity.get('source_id'):
            raise ValueError('Missing provider identity')
        frame, volume = frame_from_values(raw, daily=tf == 'D')
        return json_bars(frame, volume), identity
    try:
        daily, di = await get('CBOE:VIX', 'D', 120)
        bars, bi = await get('CBOE:VIX', '3', 1200)
        if di != bi:
            raise ValueError('VIX interval identities differ')
        first_seen = old.get('vix', {}).get('first_seen', {})
        for b in bars:
            if datetime.fromisoformat(b['time']) + timedelta(minutes=3) <= now:
                first_seen.setdefault(b['time'], now.isoformat())
        result['vix'] = {'daily': daily, 'bars': bars, 'source': bi, 'first_seen': first_seen}
    except Exception as exc:
        result['errors'].append('VIX DATA HOLD: ' + str(exc))
        # Old confirmed bars can grade history, never authorize a fresh stale entry.
        result.setdefault('vix', {'daily': [], 'bars': []})
    overnight = result.setdefault('overnight', {})
    for ticker in ('SPY', 'AAPL', 'GOOGL'):
        if ticker in overnight:
            continue
        try:
            bars, identity = await get(SYMBOLS[ticker][0], '3', 1000, 'extended')
            local = [(datetime.fromisoformat(b['time']).astimezone(ZoneInfo('America/New_York')), b) for b in bars]
            prior = [d.date() for d,b in local if d.date().isoformat() < day and d.hour >= 16]
            if not prior:
                raise ValueError('Previous after-hours session missing')
            prev = max(prior)
            selected = [(d,b) for d,b in local if (d.date() == prev and 16 <= d.hour < 20) or (d.date().isoformat() == day and '04:00' <= d.strftime('%H:%M') < '09:30')]
            times = {d.strftime('%Y-%m-%d %H:%M') for d,b in selected}
            if not all(x in times for x in (f'{prev} 16:00', f'{prev} 19:57', f'{day} 04:00', f'{day} 09:27')):
                raise ValueError('Incomplete overnight endpoints')
            overnight[ticker] = {'high': max(b['high'] for d,b in selected), 'low': min(b['low'] for d,b in selected), 'source': identity, 'captured_at': now.isoformat()}
        except Exception as exc:
            result['errors'].append(ticker + ' overnight unavailable; conservative 10:00 start: ' + str(exc))
    path.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({'shadow_context': day, 'errors_n': len(result['errors'])}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, required=True)
    asyncio.run(collect(parser.parse_args().state_dir))
