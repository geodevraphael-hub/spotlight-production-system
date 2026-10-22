"""Deploy a git commit of spotlight-production-system to spotlight.co.tz.

Generalises the 2026-10-15 deploy.py: build a full image from a clean checkout, smoke-test
it in an isolated preview container, back up the production database, then swap the live
container while keeping the previous one for rollback.

Run on the server as root (installed at /srv/apps/spotlight-planner/deploy-release.py):
  python3 deploy-release.py <commit-or-branch>            # build + preview only (no swap)
  python3 deploy-release.py <commit-or-branch> --promote  # also replace the live container
Pushes to the `production` branch are deployed with --promote by autodeploy.sh (systemd timer).
"""
import argparse, json, os, sqlite3, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path('/srv/apps/spotlight-planner')
REPO = 'https://github.com/geodevraphael-hub/spotlight-production-system.git'
LIVE = 'spotlight-planner'
LIVE_PORT = 3100
sys.path.insert(0, str(ROOT))
from smoke import smoke  # noqa: E402  (server-side, staging-only checks)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def healthy(port):
    for _ in range(80):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=10) as response:
                if response.status == 200 and b'Spotlight OOH' in response.read(): return
        except (OSError, urllib.error.URLError): pass
        time.sleep(2)
    raise RuntimeError('HTTP readiness failed')


def checkout(ref):
    stamp = time.strftime('%Y%m%d%H%M%S')
    work = ROOT / f'releases/git-{stamp}'
    run('git', 'clone', '--quiet', REPO, str(work))
    run('git', '-C', str(work), 'checkout', '--quiet', ref)
    sha = subprocess.check_output(['git', '-C', str(work), 'rev-parse', '--short=12', 'HEAD'], text=True).strip()
    release = ROOT / f'releases/git-{stamp}-{sha}'
    work.rename(release)
    return release, sha


def preview(image):
    name = f'spotlight-preview-{int(time.time())}'
    # Fresh, empty state: the preview never sees production data or secrets.
    docker('run', '-d', '--name', name, '-p', '127.0.0.1::3000', image, 'npm', 'run', 'dev', '--', '--hostname', '0.0.0.0')
    try:
        port = docker('port', name, '3000/tcp').rsplit(':', 1)[1]
        healthy(port)
        smoke(port)
    finally:
        docker('rm', '-f', name)
    print('Preview container passed smoke checks.', flush=True)


def backup_database(release):
    backup_dir = release / 'database-backup'
    backup_dir.mkdir(mode=0o700)
    for path in (ROOT / 'data/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite'):
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as source, sqlite3.connect(backup_dir / path.name) as target:
            source.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    print(f'Consistent production database backup verified in {backup_dir}.', flush=True)


def promote(release, image, sha):
    original = json.loads(docker('inspect', LIVE))[0]
    rollback = f'{LIVE}-before-{sha}'
    assert not docker('ps', '-aq', '--filter', f'name=^{rollback}$'), f'{rollback} already exists'
    backup_database(release)
    env_path = release / 'runtime.env'
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file: file.write('\n'.join(original['Config']['Env']) + '\n')
    args = ['run', '-d', '--name', LIVE, '--restart', original['HostConfig']['RestartPolicy']['Name'], '--env-file', str(env_path)]
    for target, bindings in original['HostConfig']['PortBindings'].items():
        for binding in bindings: args += ['-p', f'{binding["HostIp"] + ":" if binding["HostIp"] else ""}{binding["HostPort"]}:{target}']
    for mount in original['Mounts']:
        assert mount['Type'] == 'bind'
        args += ['-v', f'{mount["Source"]}:{mount["Destination"]}' + ('' if mount['RW'] else ':ro')]
    args += [image]  # the image's own CMD matches the live start command
    docker('stop', '-t', '25', LIVE)
    docker('rename', LIVE, rollback)
    try:
        docker(*args)
        healthy(LIVE_PORT)
        deployed = json.loads(docker('inspect', LIVE))[0]
        assert sorted(deployed['Config']['Env']) == sorted(original['Config']['Env'])
        assert deployed['Mounts'] == original['Mounts']
        run(sys.executable, str(release / 'deploy/smoke-reports.py'))
    except Exception:
        if docker('ps', '-aq', '--filter', f'name=^{LIVE}$'): docker('rm', '-f', LIVE)
        docker('rename', rollback, LIVE)
        docker('start', LIVE)
        print('Previous production container restored.', flush=True)
        raise
    finally:
        env_path.unlink()
    print(f'Production healthy on {image}. Rollback container {rollback} and database backup retained.', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('ref', help='commit sha, tag or branch to deploy')
    parser.add_argument('--promote', action='store_true', help='replace the live container after the preview passes')
    options = parser.parse_args()
    release, sha = checkout(options.ref)
    image = f'spotlight-planner:git-{sha}'
    run('docker', 'build', '-t', image, str(release))
    preview(image)
    if options.promote: promote(release, image, sha)
    else: print(f'Built and previewed {image}. Re-run with --promote to go live.', flush=True)


if __name__ == '__main__':
    main()
