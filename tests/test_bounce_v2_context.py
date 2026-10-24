import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import capture_bounce_v2_context as capture
class BounceV2ContextTests(unittest.TestCase):
    def test_weekend_has_no_requests_or_state(self):
        async def fail(*args):
            self.fail('Weekend must not call provider')
        with tempfile.TemporaryDirectory() as tmp:
            asyncio.run(capture.collect(Path(tmp), datetime(2026,10,24,16,tzinfo=timezone.utc), fail))
            self.assertEqual(list(Path(tmp).rglob('*.json')), [])
    def test_failure_is_separate_hold_and_does_not_write_live_data(self):
        async def fail(*args):
            raise RuntimeError('offline')
        with tempfile.TemporaryDirectory() as tmp:
            asyncio.run(capture.collect(Path(tmp), datetime(2026,10,26,16,tzinfo=timezone.utc), fail))
            files=list(Path(tmp).rglob('*.json'))
            self.assertEqual(len(files),1)
            self.assertIn('level-bounce-v2/context', str(files[0]))
            x=json.loads(files[0].read_text())
            self.assertEqual(x['series'],{})
            self.assertEqual(len(x['errors']),5)
    def test_completed_hour_cache_skips_all_requests(self):
        now=datetime(2026,10,26,16,tzinfo=timezone.utc)
        calendar=json.loads((ROOT/'hosting/session-calendar.json').read_text())
        series={s:{'latest_confirmed_at':capture.expected_close(calendar,5 if s=='VIX5' else 60,now).isoformat()} for s in ('VIX5','SPY','SPX','AAPL','GOOGL')}
        async def fail(*args):
            self.fail('Complete cached interval must not request again')
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)/'level-bounce-v2/context'
            directory.mkdir(parents=True)
            (directory/'2026-10-26.json').write_text(json.dumps({'day':'2026-10-26','series':series}))
            asyncio.run(capture.collect(Path(tmp),now,fail))
    def test_expected_close_obeys_partial_last_hour_and_dst(self):
        calendar=json.loads((ROOT/'hosting/session-calendar.json').read_text())
        self.assertEqual(capture.expected_close(calendar,60,datetime(2026,10,23,20,tzinfo=timezone.utc)).hour,20)
        self.assertEqual(capture.expected_close(calendar,60,datetime(2026,11,2,15,tzinfo=timezone.utc)).date().isoformat(),'2026-10-30')
