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
    if (WORK / 'latest.json').exists():
        shutil.copyfile(WORK / 'latest.json', ROOT / 'site/data/latest.json')
    print('Durable public state prepared.')


def commit():
    if not (WORK / '.git').exists():
        raise RuntimeError('Prepare the isolated state worktree first.')
    shutil.copyfile(ROOT / 'site/data/latest.json', WORK / 'latest.json')
    (WORK / 'README.md').write_text(
        '# Generated dashboard observations\n\n'
        'Updated by the main-branch dashboard workflow. Source code and manual '
        'Unusual Whales inputs live on main. Do not store credentials or private lessons here.\n\n'
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
