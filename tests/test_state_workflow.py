"""Exercise the data-branch lifecycle against a disposable local Git remote."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/sync_state.py'


def run(*args, cwd=None, check=True):
    return subprocess.run(args, cwd=cwd, check=check, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)


class StateBranchTests(unittest.TestCase):
    def test_bootstrap_restore_and_no_main_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, source, second = (root / name for name in ('remote.git', 'source', 'second'))
            run('git', 'init', '--bare', str(remote))
            run('git', 'init', '-b', 'main', str(source))
            run('git', 'config', 'user.name', 'Test', cwd=source)
            run('git', 'config', 'user.email', 'test@example.invalid', cwd=source)
            (source / 'scripts').mkdir()
            (source / 'site/data').mkdir(parents=True)
            shutil.copyfile(SCRIPT, source / 'scripts/sync_state.py')
            (source / 'site/data/latest.json').write_text('{"snapshot":1}\n')
            (source / 'README.md').write_text('Source branch\n')
            run('git', 'add', '.', cwd=source)
            run('git', 'commit', '-m', 'base', cwd=source)
            run('git', 'remote', 'add', 'origin', str(remote), cwd=source)
            run('git', 'push', 'origin', 'main', cwd=source)
            original = run('git', 'rev-parse', 'HEAD', cwd=source).stdout.strip()
            run(sys.executable, 'scripts/sync_state.py', 'prepare', cwd=source)
            journal = source / '.dashboard-state/state/observations.jsonl'
            journal.write_text('{"id":"preserve-me"}\n')
            run(sys.executable, 'scripts/sync_state.py', 'commit', cwd=source)
            self.assertEqual(run('git', 'rev-parse', 'HEAD', cwd=source).stdout.strip(), original)
            self.assertEqual(run('git', '--git-dir', str(remote), 'rev-parse', 'main').stdout.strip(), original)
            generated = run('git', '--git-dir', str(remote), 'ls-tree', '-r', '--name-only', 'dashboard-data').stdout
            self.assertNotIn('scripts/', generated)
            self.assertIn('state/observations.jsonl', generated)
            self.assertIn('latest.json', generated)
            run('git', 'clone', '--branch', 'main', str(remote), str(second))
            run(sys.executable, 'scripts/sync_state.py', 'prepare', cwd=second)
            self.assertEqual((second / '.dashboard-state/state/observations.jsonl').read_text(), journal.read_text())
            (second / 'site/data/latest.json').write_text('{"snapshot":2}\n')
            run(sys.executable, 'scripts/sync_state.py', 'commit', cwd=second)
            saved = run('git', '--git-dir', str(remote), 'show', 'dashboard-data:latest.json').stdout
            self.assertEqual(json.loads(saved), {'snapshot': 2})
            self.assertEqual(run('git', '--git-dir', str(remote), 'rev-parse', 'main').stdout.strip(), original)


if __name__ == '__main__':
    unittest.main()
