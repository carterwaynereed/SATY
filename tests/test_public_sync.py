import copy
from datetime import datetime,timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('sync_public',ROOT/'scripts/sync_public_inputs.py')
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class PublicSyncTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,10,23,20,10,tzinfo=timezone.utc)
        self.value={'schema_version':1,'public_safe':True,'symbol':'SPY','asof':'2026-10-23T19:50:00Z','method':'Manual UW','expiry_scope':'0DTE',
                    'leaderboard':[{'contract':'TEST-ONLY','type':'call','expiry':'2026-10-23','strike':760,'volume':100,'premium':None,'contract_vwap':None,'likely_shakeout':None}],
                    'max_pain':{'spot':None,'low':759,'high':761},'gex':{'units':'test units','nodes':[{'strike':760,'gamma':-5,'label':'test-only'}]},
                    'lessons':[{'source_url':'https://www.youtube.com/watch?v=test','paraphrase':'Test hypothesis','observed_at':'2026-10-23T20:05:00Z'}]}
    def test_requires_opt_in_and_no_extra_private_fields(self):
        for delta in [{'public_safe':False},{'journal':[]},{'api_key':'private'},{'symbol':'OTHER'}]:
            with self.assertRaises(ValueError):sync.validate({**self.value,**delta},self.now)
    def test_rejects_nonzero_dte_nonfinite_future_and_sensitive_text(self):
        for mutate in [lambda x:x['leaderboard'][0].update(expiry='2026-10-24'),lambda x:x['gex']['nodes'][0].update(gamma=float('nan')),lambda x:x.update(asof='2026-10-24T20:00:00Z'),lambda x:x['lessons'][0].update(paraphrase='api_key=private'),lambda x:x['lessons'][0].update(source_url='https://example.com/?token=private')]:
            x=copy.deepcopy(self.value);mutate(x)
            with self.assertRaises(ValueError):sync.validate(x,self.now)
    def test_deduplication_public_fields_and_immutable_receipt(self):
        with tempfile.TemporaryDirectory() as td:
            data=Path(td)/'data';state=Path(td)/'state'
            one=sync.sync(self.value,data,state,self.now);two=sync.sync(self.value,data,state,self.now)
            self.assertFalse(one['duplicate']);self.assertTrue(two['duplicate'])
            shared=json.loads((data/'manual-inputs.json').read_text());self.assertEqual(len(shared['lessons']),1)
            self.assertEqual(shared['by_symbol']['SPY']['received_at'],self.now.isoformat())
            self.assertEqual(len(list((state/'inputs').glob('*.json'))),1)
    def test_backdated_snapshot_does_not_replace_latest(self):
        with tempfile.TemporaryDirectory() as td:
            data=Path(td)/'data';state=Path(td)/'state';sync.sync(self.value,data,state,self.now)
            older=copy.deepcopy(self.value);older['asof']='2026-10-23T19:40:00Z'
            sync.sync(older,data,state,self.now)
            self.assertIn('19:50',json.loads((data/'manual-inputs.json').read_text())['by_symbol']['SPY']['asof'])
if __name__=='__main__':unittest.main()
