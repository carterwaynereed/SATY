"""Persist public generated data on dashboard-data, never the source branch.

Run only in the trusted main-branch workflow. Uses the ephemeral GITHUB_TOKEN
credential installed by actions/checkout; no personal access token is required.
"""
import argparse
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.dashboard-state'
BRANCH = 'dashboard-data'
PUBLIC_FILES = ('latest.json', 'evidence.json', 'uw.json', 'learning.json', 'market.json', 'tv-evidence.json', 'eod-review.json', 'health-alarms.json', 'changelog.json', 'challengers.jsonl')


def git(*args, cwd=ROOT, check=True, capture=False):
    return subprocess.run(['git', *args], cwd=cwd, check=check, text=True,
                          stdout=subprocess.PIPE if capture else None)


def prepare():
    if WORK.exists():
        raise RuntimeError('State worktree already exists; use a fresh workflow checkout.')
    remote = git('ls-remote', '--exit-code', '--heads', 'origin', BRANCH,
                 check=False, capture=True)
    if remote.returncode == 0:
        git('fetch', '--depth=1', 'origin', BRANCH)
        git('worktree', 'add', '--detach', str(WORK), 'FETCH_HEAD')
    elif remote.returncode == 2:
        git('worktree', 'add', '--detach', str(WORK), 'HEAD')
        git('checkout', '--orphan', BRANCH, cwd=WORK)
        git('rm', '-rf', '--ignore-unmatch', '.', cwd=WORK)
    else:
        raise RuntimeError('Could not check the remote data branch; refusing to overwrite state.')
    (WORK / 'state').mkdir(exist_ok=True)
    for name in PUBLIC_FILES:
        if (WORK / name).exists():
            shutil.copyfile(WORK / name, ROOT / 'site/data' / name)
    print('Durable public state prepared.')


def commit():
    if not (WORK / '.git').exists():
        raise RuntimeError('Prepare the isolated state worktree first.')
    # One Git commit publishes the complete shared public bundle. Browser clients
    # still compare evidence IDs because CDN caches can serve files of different ages.
    for name in PUBLIC_FILES:
        shutil.copyfile(ROOT / 'site/data' / name, WORK / name)
    (WORK / 'README.md').write_text(
        '# Generated dashboard observations\n\n'
        'Updated by the main-branch dashboard workflow. Source code and manual '
        'Unusual Whales inputs live on main. Do not store credentials or private lessons here.\n\n'
        '`market.json`, `tv-evidence.json`, `latest.json`, `evidence.json`, `uw.json`, `learning.json`, `eod-review.json`, `health-alarms.json`, `changelog.json` and `challengers.jsonl` are the shared '
        'public JSON bundle consumed by the Saty+ home and the optional Pages mirror. '
        'They are committed together; consumers must still validate timestamps and '
        'match the snapshot evidence ID to the evidence statistics ID.\n\n'
        '`latest.json` is a periodic snapshot. `state/` preserves first-observed '
        'events and later outcomes for research. Modeled entries are not executed '
        'trades or certified real-time forward signals.\n', encoding='utf-8')
    git('add', '--all', cwd=WORK)
    diff = git('diff', '--cached', '--quiet', cwd=WORK, check=False)
    if diff.returncode == 0:
        print('No generated state changes.')
        return
    if diff.returncode != 1:
        raise RuntimeError('Could not inspect state diff.')
    git('-c', 'user.name=github-actions[bot]',
        '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'data: refresh dashboard observations', cwd=WORK)
    # No force push: concurrent/manual edits must be reconciled, never discarded.
    git('push', 'origin', f'HEAD:refs/heads/{BRANCH}', cwd=WORK)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'commit'])
    args = parser.parse_args()
    (prepare if args.action == 'prepare' else commit)()
