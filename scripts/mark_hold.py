"""Retain last-known values while explicitly disabling the decision panel."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from saty_dashboard.providers import DataQualityError
from saty_dashboard.runner import atomic_json, failure_snapshot

path = Path(__file__).resolve().parents[1] / 'site/data/latest.json'
previous = json.loads(path.read_text(encoding='utf-8'))
reason = sys.argv[1] if len(sys.argv) > 1 else 'The update could not be safely completed.'
atomic_json(path, failure_snapshot(previous, None, DataQualityError(reason)))
