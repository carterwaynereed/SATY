"""Source provenance, chronology and counted-event checks for rebuilt evidence."""
from collections import Counter
from datetime import date
import gzip
import json
from pathlib import Path
import unittest

from saty_dashboard.tv_evidence import (SYMBOLS, _counts, eligible_sessions, frame_from_values, source_identity)
from saty_dashboard.providers import regular_completed
from saty_dashboard.probability import wilson

ROOT = Path(__file__).resolve().parents[1]


class TradingViewEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = json.loads((ROOT / 'site/data/tv-evidence.json').read_text())
        cls.histories = {s: json.loads(gzip.decompress((ROOT / 'stats/tv' / s / 'history.json.gz').read_bytes())) for s in SYMBOLS}

    def test_no_cross_ticker_pooling_and_exact_live_identity(self):
        hashes = {
            'SPY': '0871282d71d54512594cd572403027f9b14e543690d40ecfb3bf94ae21bf7d85',
            'SPX': '00cfe08993dbbafd000d606cb76ecff691757fd4328bf8e1418a29126159c085',
            'AAPL': 'e118f5ebeaa8e93e2f7d26b0b705a9f65a0d25c22a460f5bbd90e3cea1d8fa86',
            'GOOGL': '140b6d42fe339f67c0a7be624d1fc5e8a8fe66ba0a345d60668784ed0fd50cd6',
        }
        self.assertEqual(set(self.bundle['by_symbol']), set(SYMBOLS))
        for ticker, history in self.histories.items():
            evidence = self.bundle['by_symbol'][ticker]
            self.assertEqual(evidence['source'], source_identity(history['tv_symbol'], history['metadata']))
            self.assertEqual(evidence['source']['fingerprint'], 'sha256:' + hashes[ticker])
            self.assertEqual(source_identity(history['tv_symbol'], history['daily_metadata']), evidence['source'])
        self.assertEqual(len({v['stats_id'] for v in self.bundle['by_symbol'].values()}), 4)

    def test_same_brand_is_not_same_feed_or_ticker(self):
        primary = source_identity('AMEX:SPY', {'source_id': 'BATS'})
        alternate = source_identity('AMEX:SPY', {'source_id': 'Cboe One'})
        another = source_identity('NASDAQ:AAPL', {'source_id': 'BATS'})
        self.assertNotEqual(primary['fingerprint'], alternate['fingerprint'])
        self.assertNotEqual(primary['fingerprint'], another['fingerprint'])

    def test_training_excludes_current_session_and_requires_full_warmup(self):
        h = self.histories['SPY']
        daily, _ = frame_from_values(h['daily'], True)
        bars, _ = frame_from_values(h['bars3'])
        bars = regular_completed(bars, h['captured_at'], 3)
        accepted, excluded = eligible_sessions(daily, bars, h['captured_at'])
        self.assertEqual([str(d) for d in accepted], json.loads(gzip.decompress((ROOT / 'stats/tv/SPY/ledger.json.gz').read_bytes()))['training_sessions'])
        self.assertTrue(all(d < date.fromisoformat(h['captured_at'][:10]) for d in accepted))
        self.assertTrue(any('400' in row['reason'] for row in excluded))
        self.assertTrue(any('Current/future' in row['reason'] for row in excluded))

    def test_missing_bar_invalidates_training_session_and_later_warmup(self):
        h = self.histories['SPY']
        daily, _ = frame_from_values(h['daily'], True)
        bars, _ = frame_from_values(h['bars3'])
        bars = regular_completed(bars, h['captured_at'], 3)
        accepted, _ = eligible_sessions(daily, bars, h['captured_at'])
        removed_day = accepted[-3]
        removed_stamp = bars[bars.index.date == removed_day].index[60]
        altered, excluded = eligible_sessions(daily, bars.drop(removed_stamp), h['captured_at'])
        self.assertNotIn(removed_day, altered)
        self.assertNotIn(accepted[-2], altered)
        self.assertTrue(any(row['reason'].startswith('Gap in') for row in excluded))

    def test_absent_index_volume_is_explicit_not_a_vwap_input(self):
        spy, spy_volume = frame_from_values(self.histories['SPY']['bars3'])
        spx, spx_volume = frame_from_values(self.histories['SPX']['bars3'])
        self.assertTrue(spy_volume)
        self.assertFalse(spx_volume)
        self.assertTrue((spx.Volume == 0).all())
        self.assertFalse(self.bundle['by_symbol']['SPX']['volume_available'])

    def test_each_target_cell_reconciles_to_ledger_ids_and_wilson(self):
        for ticker, evidence in self.bundle['by_symbol'].items():
            audit = json.loads(gzip.decompress((ROOT / 'stats/tv' / ticker / 'ledger.json.gz').read_bytes()))
            obs = audit['observations']
            ids = [(r['episode_id'], r['target_index']) for r in obs]
            self.assertEqual(len(ids), len(set(ids)), ticker + ' target event counted twice')
            self.assertTrue(all(e['symbol'] == ticker for e in audit['ledger']))
            self.assertEqual(sum(c['n'] for c in evidence['cells']), len(obs))
            for cell in evidence['cells']:
                rows = [r for r in obs if all(r[k] == cell[k] for k in ('setup', 'cohort', 'target_index', 'rr_bucket'))]
                expected = _counts(rows)
                for k, value in expected.items():
                    self.assertEqual(cell[k], value, f'{ticker} {k}')
                self.assertEqual(cell['interval'], wilson(cell['hits'], cell['n']))
            self.assertEqual(sum(c['t1']['n'] for c in evidence['cohorts']), sum(r['target_index'] == 1 for r in obs))

    def test_counts_never_treat_other_targets_as_independent_episodes(self):
        rows = [{'episode_id': 'a', 'day': '2026-10-22', 'y': 1, 'y_tf': 1, 'amb': 0, 'to': 0},
                {'episode_id': 'b', 'day': '2026-10-22', 'y': 0, 'y_tf': 1, 'amb': 1, 'to': 0}]
        count = _counts(rows)
        self.assertEqual((count['hits'], count['n'], count['episodes'], count['sessions']), (1, 2, 2, 1))
        self.assertEqual(count['rate'], .5)
        self.assertEqual(count['target_first_sensitivity'], 1)
        self.assertEqual(count['ambiguous'], 1)
        self.assertEqual(count['interval'], wilson(1, 2))

    def test_development_and_count_gate_remain_explicit(self):
        for evidence in self.bundle['by_symbol'].values():
            self.assertEqual(evidence['evidence_state'], 'DEVELOPMENT')
            self.assertEqual(evidence['minimum_headline_n'], 20)
            self.assertEqual(evidence['forward']['validated_episodes'], 0)
            self.assertEqual(evidence['replay']['intrabar'], '3m stop-first')
            self.assertLess(evidence['training_to'], evidence['built'][:10])
            self.assertEqual(evidence['available_at'], evidence['built'])
            self.assertTrue(any(c['n'] < 20 for c in evidence['cells']))


if __name__ == '__main__':
    unittest.main()
