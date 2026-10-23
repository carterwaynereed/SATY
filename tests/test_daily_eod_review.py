import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts'/'daily_eod_review.py'
class DailyEODReviewTests(unittest.TestCase):
    def fixture(self, root, wait=95, with_signal=False):
        data=root/'data';state=root/'state';data.mkdir()
        now='2026-10-23T21:10:00Z'
        bars=[
          {'time':'2026-10-23T19:00:00Z','open':100,'high':100.5,'low':99.8,'close':100,'phase':1},
          {'time':'2026-10-23T19:03:00Z','open':100,'high':102,'low':99.9,'close':101.5,'phase':-1},
          {'time':'2026-10-23T19:06:00Z','open':101.5,'high':102.1,'low':101,'close':102,'phase':-2},
        ]
        sig=[{'id':'s1','setup':'trigger break','side':'LONG','decision_at':'2026-10-23T19:00:00Z','entry':100,'status':'CLOSED'}] if with_signal else []
        snapshot={'schema_version':2,'generated_at':now,'symbols':{'SPY':{
          'session':{'status':'OPEN','date':'2026-10-23'},'health':{'state':'CURRENT','price_asof':'2026-10-23T19:06:00Z','age_seconds':60,'source':{'provider':'test'}},
          'market':{'last':102,'atr14':1,'change':2,'change_atr':2,'day_high':102.1,'day_low':99.8},
          'bars':bars,'signals':sig,'evidence_weights':{'call':0,'put':5,'wait':wait}}}}
        (data/'market.json').write_text(json.dumps(snapshot))
        return data,state,now
    def run_review(self,data,state,now):
        return subprocess.run([sys.executable,str(SCRIPT),'--data-dir',str(data),'--state-dir',str(state),'--now',now],capture_output=True,text=True,check=True)
    def test_all_day_wait_and_large_move_register_shadow_challenger(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td),wait=95)
            result=self.run_review(data,state,now)
            alarms=json.loads((data/'health-alarms.json').read_text())['alarms']
            self.assertTrue(any(x['type']=='ENGINE_ALL_DAY_WAIT' for x in alarms))
            self.assertTrue((data/'challengers.jsonl').exists())
            self.assertIn('challenger_candidates_created',result.stdout)
            self.assertEqual(json.loads((data/'changelog.json').read_text())['entries'][0]['promotion'],'NOT_PROMOTED')
    def test_signal_outcomes_are_graded_with_sample_size_and_interval(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td),wait=20,with_signal=True)
            self.run_review(data,state,now)
            report=json.loads((data/'eod-review.json').read_text())['sessions'][0]
            self.assertEqual(report['signal_count'],1)
            self.assertEqual(report['sample_n'],1)
            self.assertIsNotNone(report['favorable_excursion_dominant_interval_95_wilson'])
            self.assertIn('wait_assessment',report)
    def test_stale_feed_alarm_only_when_snapshot_session_was_open(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td),wait=10)
            doc=json.loads((data/'market.json').read_text());doc['symbols']['SPY']['health']['age_seconds']=500
            (data/'market.json').write_text(json.dumps(doc))
            self.run_review(data,state,now)
            alarms=json.loads((data/'health-alarms.json').read_text())['alarms']
            self.assertTrue(any(x['type']=='STALE_FEED' for x in alarms))
if __name__=='__main__': unittest.main()
