#!/usr/bin/env python3
"""One cached native VIX15 request; 1H research captures already run on this cadence."""
import argparse
import asyncio
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from refresh_tv_market import tvdata, frame_from_values, json_bars, source_identity
from capture_bounce_v2_context import expected_close, ROOT
async def collect(state, clock=None, pull=None):
    now=clock or datetime.now(timezone.utc)
    pull=pull or tvdata._get
    day=now.astimezone(ZoneInfo('America/New_York')).date().isoformat()
    calendar=json.loads((ROOT/'hosting/session-calendar.json').read_text())
    if day not in calendar['sessions']:
        return
    directory=state/'live-alerts/context'
    directory.mkdir(parents=True,exist_ok=True)
    path=directory/(day+'.json')
    old=json.loads(path.read_text()) if path.exists() else {}
    expected=expected_close(calendar,15,now)
    if expected and old.get('latest_confirmed_at')==expected.isoformat():
        return
    try:
        raw=await asyncio.wait_for(pull('CBOE:VIX','15',500,'regular',10),14)
        meta=dict(tvdata.META.get('CBOE:VIX',{}))
        source=source_identity('CBOE:VIX',meta)
        if not source.get('source_id'):
            raise ValueError('Missing VIX source identity')
        frame,volume=frame_from_values(raw)
        bars=[]
        latest=None
        for b in json_bars(frame,volume):
            t=datetime.fromisoformat(b['time'])
            s=calendar['sessions'].get(t.astimezone(ZoneInfo('America/New_York')).date().isoformat())
            if not s:
                continue
            opened,closed=datetime.fromisoformat(s['open']),datetime.fromisoformat(s['close'])
            end=min(t+timedelta(minutes=15),closed)
            if opened<=t<closed and end<=now-timedelta(seconds=max(0,meta.get('delay') or 0)):
                bars.append(b)
                latest=end
        seen=old.get('first_seen',{})
        for b in bars:
            seen.setdefault(b['time'],now.isoformat())
        result={'day':day,'bars':bars,'first_seen':seen,'source':source,'captured_at':now.isoformat(),'latest_confirmed_at':latest.isoformat() if latest else None}
    except Exception as exc:
        result={**old,'day':day,'error':'DATA HOLD: '+str(exc)}
    path.write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n')
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--state-dir',type=Path,required=True)
    asyncio.run(collect(p.parse_args().state_dir))
