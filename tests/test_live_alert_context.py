import asyncio
from datetime import datetime,timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import capture_live_alert_context as capture
class LiveAlertContextTests(unittest.TestCase):
    def test_weekend_does_not_request(self):
        async def fail(*args):
            self.fail('No weekend request')
        with tempfile.TemporaryDirectory() as tmp:
            asyncio.run(capture.collect(Path(tmp),datetime(2026,10,24,16,tzinfo=timezone.utc),fail))
            self.assertEqual(list(Path(tmp).rglob('*.json')),[])
    def test_provider_failure_writes_hold_outside_public_assets(self):
        async def fail(*args):
            raise RuntimeError('offline')
        with tempfile.TemporaryDirectory() as tmp:
            asyncio.run(capture.collect(Path(tmp),datetime(2026,10,26,16,tzinfo=timezone.utc),fail))
            path=Path(tmp)/'live-alerts/context/2026-10-26.json'
            self.assertTrue(json.loads(path.read_text())['error'].startswith('DATA HOLD'))
    def test_cached_completed_interval_avoids_request(self):
        now=datetime(2026,10,26,16,tzinfo=timezone.utc)
        calendar=json.loads((ROOT/'hosting/session-calendar.json').read_text())
        async def fail(*args):
            self.fail('Cached interval should not refresh')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'live-alerts/context/2026-10-26.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'latest_confirmed_at':capture.expected_close(calendar,15,now).isoformat()}))
            asyncio.run(capture.collect(Path(tmp),now,fail))
