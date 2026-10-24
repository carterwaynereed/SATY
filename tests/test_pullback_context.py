import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import capture_pullback_context as capture

class PullbackContextTests(unittest.TestCase):
    def test_provider_failure_writes_hidden_hold_without_public_outputs(self):
        async def fail(*args):
            raise RuntimeError('test unavailable')
        with tempfile.TemporaryDirectory() as tmp, patch.object(capture.tvdata, '_get', fail):
            asyncio.run(capture.collect(Path(tmp)))
            files = list(Path(tmp).rglob('*.json'))
            self.assertEqual(len(files), 1)
            self.assertIn('pullback-vix/context', str(files[0]))
            result = json.loads(files[0].read_text())
            self.assertEqual(result['vix']['bars'], [])
            self.assertEqual(len(result['errors']), 4)
            self.assertTrue(result['errors'][0].startswith('VIX DATA HOLD'))

    def test_successful_overnight_cache_skips_repeat_equity_requests(self):
        calls = []
        async def fail(symbol, *args):
            calls.append(symbol)
            raise RuntimeError('test unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            directory = state / 'pullback-vix/context'
            directory.mkdir(parents=True)
            from datetime import datetime
            from zoneinfo import ZoneInfo
            day = datetime.now(ZoneInfo('America/New_York')).date().isoformat()
            (directory / (day+'.json')).write_text(json.dumps({'overnight': {s: {'low': 1, 'high': 2} for s in ('SPY','AAPL','GOOGL')}}))
            with patch.object(capture.tvdata, '_get', fail):
                asyncio.run(capture.collect(state))
            self.assertEqual(calls, ['CBOE:VIX'])
