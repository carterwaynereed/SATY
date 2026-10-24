"""Validate the public payload and the frozen input version without network access."""
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
from summarize_learning import summarize

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    def invalid(value):
        raise ValueError(f'Non-finite JSON value: {value}')
    return json.loads(path.read_text(encoding='utf-8'), parse_constant=invalid)


def validate_finite(value):
    if isinstance(value, float):
        assert math.isfinite(value), 'Non-finite number'
    elif isinstance(value, dict):
        for item in value.values():
            validate_finite(item)
    elif isinstance(value, list):
        for item in value:
            validate_finite(item)


def aware(value):
    if value is None:
        return
    ts = datetime.fromisoformat(value.replace('Z', '+00:00'))
    assert ts.tzinfo is not None, f'Naive timestamp: {value}'


def main():
    site = ROOT / 'site'
    latest = load(site / 'data/latest.json')
    evidence = load(site / 'data/evidence.json')
    uw = load(site / 'data/uw.json')
    learning = load(site / 'data/learning.json')
    for value in (latest, evidence, uw, learning):
        assert value['schema_version'] == 1
        validate_finite(value)
    aware(latest.get('generated_at'))
    aware(latest['health'].get('price_asof'))
    for key in ('open', 'close'):
        aware(latest['session'].get(key))
    assert latest['plan']['state'] in ('WAIT', 'TRACKING', 'DATA_HOLD')
    assert latest['strategy']['version'] == 'saty-sig-2.0'
    for signal in latest.get('signals', []):
        for target in signal.get('targets', []):
            probability = target.get('probability') or {}
            if probability.get('display_probability') is not None:
                assert probability['n'] >= 20, 'Thin sample shown as headline probability'
                assert 0 <= probability['display_probability'] <= 1
            if probability.get('n', 0):
                assert 0 <= probability['hits'] <= probability['n']
    assert evidence['evidence_state'] == 'DEVELOPMENT'
    market = load(site / 'data/market.json')
    tv_evidence = load(site / 'data/tv-evidence.json')
    assert market['schema_version'] == tv_evidence['schema_version'] == 2
    assert set(market['symbols']) == set(tv_evidence['by_symbol']) == {'SPY', 'SPX', 'AAPL', 'GOOGL'}
    validate_finite(market)
    validate_finite(tv_evidence)
    for symbol, snapshot in market['symbols'].items():
        aware(snapshot['health'].get('price_asof'))
        weights = snapshot['evidence_weights']
        assert sum(weights[k] for k in ('call', 'put', 'wait')) == 100
        assert all(0 <= weights[k] <= 100 for k in ('call', 'put', 'wait'))
        for signal in snapshot.get('signals', []):
            for target in signal.get('targets', []):
                p = target['probability']
                if p.get('display_probability') is not None:
                    assert p['n'] >= 20 and p['episodes'] >= 20
                    assert snapshot['health']['source']['baseline_compatible']
                    assert 0 <= p['display_probability'] <= 1
    assert learning == summarize(ROOT / 'learning'), 'Regenerate learning.json from the learning registry'
    assert uw['status'] in ('placeholder', 'manual')
    assert uw['symbol'] in ('SPY', 'SPX')
    if uw['status'] == 'manual':
        assert uw.get('asof'), 'Manual context requires its observation timestamp'
        aware(uw['asof'])
        assert uw.get('method'), 'Manual context requires method/coverage notes'
        assert uw.get('expiry_scope'), 'Manual context requires expiry coverage'
    manifest = load(ROOT / 'docs/engine-manifest.json')
    for name, expected in manifest['sha256'].items():
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        assert actual == expected, f'Frozen source changed without version review: {name}'
    assert (site / 'index.html').exists()
    assert (site / 'assets/app.js').exists()
    assert (site / 'assets/styles.css').exists()
    assert not list(site.rglob('*.py')), 'Python source should not be in the deployed site'
    assert not list(site.rglob('node_modules')), 'No runtime dependencies belong in the static artifact'
    payload = sum(p.stat().st_size for p in site.rglob('*') if p.is_file())
    assert payload < 750_000, f'Static payload exceeded the 750 KB four-ticker/1m budget: {payload} bytes'
    print(f'Public JSON, frozen source hashes and static payload validated ({payload:,} bytes).')


if __name__ == '__main__':
    main()
