import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('review',ROOT/'scripts/daily_eod_review.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)
class DailyEODReviewTests(unittest.TestCase):
    def fixture(self,root,observed=True,signal=False,ledger=True):
        data=root/'data';state=root/'state';data.mkdir();(state/'decisions').mkdir(parents=True)
        start=datetime(2026,10,23,13,30,tzinfo=timezone.utc)
        bars=[];rows=[]
        for i in range(130):
            at=start+timedelta(minutes=3*i);price=100+i*.02
            bars.append({'time':at.isoformat(),'open':price,'high':price+.1,'low':price-.1,'close':price})
            rows.append({'id':f'SPY-{i}','symbol':'SPY','time':(at+timedelta(minutes=3)).isoformat(),
                         'session_date':'2026-10-23','observed_at':(at+timedelta(minutes=3,seconds=10)).isoformat(),
                         'observation_kind':'OBSERVED' if observed else 'REPLAY_LATE',
                         'decision':'CALL' if signal and i==0 else 'WAIT','close':price,'atr14':1,
                         'source_fingerprint':'test','evidence_score':{'call':0,'put':5,'wait':95}})
        doc={'schema_version':2,'symbols':{'SPY':{'session':{'date':'2026-10-23','status':'OPEN'},
             'health':{'state':'CURRENT','age_seconds':60,'source':{'feed_fingerprint':'test'}},
             'market':{'atr14':1},'bars':bars,'signals':[],'evidence_weights':{'call':0,'put':5,'wait':95}}}}
        (data/'market.json').write_text(json.dumps(doc))
        if ledger:(state/'decisions/2026-10-23.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in rows))
        return data,state,datetime(2026,10,23,21,10,tzinfo=timezone.utc)
    def test_all_day_wait_requires_full_observed_ledger(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td));review.review(data,state,now)
            r=json.loads((data/'eod-review.json').read_text())['sessions'][0]
            self.assertEqual(r['wait_count'],130)
            self.assertTrue(any(x['type']=='ENGINE_ALL_DAY_WAIT' for x in json.loads((data/'health-alarms.json').read_text())['alarms']))
            active=[json.loads(x) for x in (data/'challengers.jsonl').read_text().splitlines() if json.loads(x).get('status')=='SHADOW']
            self.assertEqual(len(active),1);self.assertEqual(active[0]['registered_at'],now.isoformat())
            self.assertIn('rule_set',active[0]);self.assertFalse(active[0]['automatic_promotion'])
    def test_latest_wait_score_is_never_a_history_proxy(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td),ledger=False);review.review(data,state,now)
            r=json.loads((data/'eod-review.json').read_text())['sessions'][0]
            self.assertEqual(r['wait_count'],0)
            self.assertFalse(any(x['type']=='ENGINE_ALL_DAY_WAIT' for x in json.loads((data/'health-alarms.json').read_text())['alarms']))
    def test_late_replays_are_not_observed_waits(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td),observed=False);review.review(data,state,now)
            r=json.loads((data/'eod-review.json').read_text())['sessions'][0]
            self.assertEqual(r['wait_count'],0);self.assertEqual(r['replay_late_count'],130)
            alarms=json.loads((data/'health-alarms.json').read_text())['alarms']
            self.assertTrue(any(x['type']=='WAIT_REPLAY_CHECK' for x in alarms))
            self.assertFalse(any(x['type']=='ENGINE_ALL_DAY_WAIT' for x in alarms))
    def test_signal_grade_uses_actual_denominator_and_interval(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td),signal=True);review.review(data,state,now)
            r=json.loads((data/'eod-review.json').read_text())['sessions'][0]
            self.assertEqual(r['signal_count'],1);self.assertEqual(r['sample_n'],1)
            self.assertIsNotNone(r['signal_evidence']['wilson_95']);self.assertEqual(r['wait_count'],129)
            review.review(data,state,now)
            self.assertEqual(len(json.loads((data/'eod-review.json').read_text())['sessions']),1)
    def test_stale_alarm_and_after_close_exchange_gate(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td));doc=json.loads((data/'market.json').read_text());doc['symbols']['SPY']['health']['age_seconds']=500
            (data/'market.json').write_text(json.dumps(doc));review.review(data,state,now)
            self.assertTrue(any(x['type']=='STALE_FEED' for x in json.loads((data/'health-alarms.json').read_text())['alarms']))
            self.assertIn('skipped',review.review(data,state,now.replace(hour=15)))
    def test_public_lesson_receipt_after_close_not_a_past_predictor(self):
        with tempfile.TemporaryDirectory() as td:
            data,state,now=self.fixture(Path(td));p=state/'inputs';p.mkdir()
            (p/'test.json').write_text(json.dumps({'input_id':'test','symbol':'SPY','asof':'2026-10-23T19:50:00Z','received_at':'2026-10-23T21:00:00Z','lessons':[{'paraphrase':'Research hypothesis'}]}))
            review.review(data,state,now);d=json.loads((state/'reviews/2026-10-23.json').read_text())
            self.assertFalse(d['manual_inputs'][0]['available_before_close']);self.assertEqual(d['lesson_candidates_n'],1)
if __name__=='__main__':unittest.main()
