#!/usr/bin/env python3
"""Deployment orchestration tests without a container engine.
Only the /run socket path is substituted in the copied script. Engine commands
are simulated; these tests do not replace a real rootless Podman acceptance run.
"""
import json
import fcntl
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
MOCK = r'''#!/usr/bin/python3
import fcntl, json, os, pathlib, subprocess, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
path = pathlib.Path(os.environ['MOCK_STATE'])
s = json.loads(path.read_text())
s['calls'].append([name] + args)
code = 0
out = ''
mode = os.environ.get('MODE', '')
if name in ['podman', 'podman-compose']:
    inherited = []
    for fd in pathlib.Path('/proc/self/fd').iterdir():
        try:
            target = os.readlink(fd)
        except FileNotFoundError:
            continue
        if target.endswith(('/deploy.lock', '/autodeploy.lock')):
            inherited.append(str(fd))
    held = {}
    for lock_name in ['deploy.lock', 'autodeploy.lock']:
        lock = pathlib.Path(os.environ['HOME']) / '.local/state/aic-deploy' / lock_name
        with lock.open('a') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                held[lock_name] = False
            except BlockingIOError:
                held[lock_name] = True
    s.setdefault('lock_checks', []).append([name, inherited, held])
    if os.environ.get('CHECK_LOCK_LIFETIME') == name and 'persistent_pid' not in s:
        # Deliberately preserve all inherited descriptors, like a daemonizing
        # engine helper. Redirect stdio so capture_output can finish normally.
        child = subprocess.Popen(['/bin/sleep', '60'], close_fds=False,
                                 start_new_session=True, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        s['persistent_pid'] = child.pid
        path.write_text(json.dumps(s))
        (path.parent / 'ready').touch()
        deadline = time.monotonic() + 15
        while not (path.parent / 'continue').exists():
            if time.monotonic() > deadline: sys.exit(99)
            time.sleep(0.01)
if name == 'id': out = '1000'
elif name == 'git': out = 'a' * 40
elif name == 'podman-compose':
    s.setdefault('compose_images', []).append(os.environ.get('PI_RUNNER_IMAGE'))
    if '--no-build' in args:
        s['containers']['aic-agent-library'] = 'new'
        if mode == 'up-fail': code = 1
elif name == 'podman':
    if args[:2] == ['container', 'exists']: code = 0 if args[2] in s['containers'] else 1
    elif args[0] == 'build':
        if mode == 'build-fail' or (mode == 'app-build-fail' and 'Containerfile' in args): code = 1
    elif args[0] == 'run' and mode == 'env-fail': code = 1
    elif args[0] == 'rename': s['containers'][args[2]] = s['containers'].pop(args[1])
    elif args[0] == 'rm': s['containers'].pop(args[-1], None)
    elif args[:2] == ['image', 'inspect']:
        if 'pi-runner:' in args[-1]:
            out = 'runner-id'
            if mode == 'runner-missing': code = 1
            if mode == 'runner-empty-id': out = ''
        else: out = 'new'
    elif args[0] == 'inspect':
        if 'Labels' in args[2]: out = 'aic-agent-library' if mode == 'managed' else ''
        else: out = s['containers'][args[-1]]
    elif args[0] == 'exec' and 'fetch(' in args[-1] and mode == 'health-fail': code = 1
    # The Node validator itself is covered by test-validate-runner.cjs.
    if 'Runner image verified through app socket' in ' '.join(args):
        if args[0] == 'run' and mode == 'runner-socket-fail': code = 1
        if args[0] == 'exec' and mode in ['runner-env-mismatch', 'runner-lost']: code = 1
path.write_text(json.dumps(s))
if out: print(out)
sys.exit(code)
'''

class DeployTests(unittest.TestCase):
    def run_deploy(self, mode='', existing=True, inherited_lock=False, check_lifetime=''):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT / 'deploy', root / 'deploy')
            shutil.copy(ROOT / 'podman-compose.yml', root)
            runtime = root / 'runtime'
            (runtime / 'podman').mkdir(parents=True)
            with socket.socket(socket.AF_UNIX) as sock:
                sock.bind(str(runtime / 'podman/podman.sock'))
                script = (ROOT / 'deploy.sh').read_text().replace('/run/user/$(id -u)', str(runtime))
                (root / 'deploy.sh').write_text(script)
                (root / '.env').write_text('AUTH_ENABLED=false\nORIGIN=http://localhost:3000\nPI_RUNNER_IMAGE=localhost/pi-runner:stale-file\n')
                bin_dir = root / 'bin'
                bin_dir.mkdir()
                for name in ['podman', 'podman-compose', 'git', 'id', 'sleep']:
                    dest = bin_dir / name
                    dest.write_text(MOCK)
                    dest.chmod(0o755)
                state = root / 'mock.json'
                state.write_text(json.dumps({'calls': [], 'containers': {'aic-agent-library': 'old'} if existing else {}}))
                env = dict(os.environ, PATH=str(bin_dir) + ':' + os.environ['PATH'],
                           HOME=str(root), MOCK_STATE=str(state), MODE=mode,
                           PI_RUNNER_IMAGE='localhost/pi-runner:stale-shell', APP_IMAGE='stale-app')
                for key in ['APP_ENV_FILE', 'DEPLOY_STATE_DIR', 'COMPOSE_PROJECT_NAME', 'AIC_DEPLOY_LOCK_FD']:
                    env.pop(key, None)
                command = ['bash', str(root / 'deploy.sh')]
                if inherited_lock:
                    command = ['bash', '-c',
                               'mkdir -p "$HOME/.local/state/aic-deploy"; '
                               'exec 8>"$HOME/.local/state/aic-deploy/autodeploy.lock"; flock -n 8 || exit 1; '
                               'exec 9>"$HOME/.local/state/aic-deploy/deploy.lock"; '
                               'flock -n 9 || exit 1; export AIC_DEPLOY_LOCK_FD=9; exec bash "$1"',
                               'test', str(root / 'deploy.sh')]
                if check_lifetime:
                    env['CHECK_LOCK_LIFETIME'] = check_lifetime
                    with subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE, text=True) as active:
                        try:
                            deadline = time.monotonic() + 10
                            while not (root / 'ready').exists():
                                if active.poll() is not None or time.monotonic() > deadline:
                                    self.fail('Deployment did not reach the engine barrier')
                                time.sleep(0.01)
                            # Check both parent locks while an engine child is
                            # paused, before allowing deployment to finish.
                            for name in ['deploy.lock', 'autodeploy.lock']:
                                if name == 'autodeploy.lock' and not inherited_lock:
                                    continue
                                with (root / '.local/state/aic-deploy' / name).open('a') as lock:
                                    with self.assertRaises(BlockingIOError, msg=f'{name} released during deployment'):
                                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            contender = subprocess.run(['bash', str(root / 'deploy.sh')],
                                                       env=env, capture_output=True, text=True, timeout=10)
                            self.assertNotEqual(contender.returncode, 0)
                            self.assertIn('Another deployment is running', contender.stderr)
                        finally:
                            (root / 'continue').touch()
                        stdout, stderr = active.communicate(timeout=30)
                        result = subprocess.CompletedProcess(command, active.returncode, stdout, stderr)
                    first = json.loads(state.read_text())
                    first_recorded = (root / '.local/state/aic-deploy/current').exists()
                    self.assertEqual(first_recorded, result.returncode == 0)
                    pid = first['persistent_pid']
                    try:
                        os.kill(pid, 0)
                        for name in ['deploy.lock', 'autodeploy.lock']:
                            with (root / '.local/state/aic-deploy' / name).open('a') as lock:
                                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        retry_env = dict(env, MODE='managed')
                        retry_env.pop('CHECK_LOCK_LIFETIME')
                        retry = subprocess.run(command, env=retry_env, capture_output=True,
                                               text=True, timeout=30)
                        self.assertEqual(retry.returncode, 0, retry.stderr)
                    finally:
                        os.kill(pid, 15)
                    # Preserve the first deployment's assertions and state.
                    state.write_text(json.dumps(first))
                else:
                    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
                data = json.loads(state.read_text())
                data['recorded'] = first_recorded if check_lifetime else (root / '.local/state/aic-deploy/current').exists()
                for engine, inherited, held in data['lock_checks']:
                    self.assertEqual(inherited, [], f'{engine} inherited deployment locks')
                    self.assertTrue(held['deploy.lock'], f'{engine} ran without the deployment lock')
                    self.assertEqual(held['autodeploy.lock'], inherited_lock,
                                     f'{engine}: unexpected parent poller lock state')
                return result, data

    def test_persistent_children_do_not_hold_locks_after_success_or_failure(self):
        for engine in ['podman', 'podman-compose']:
            for inherited in [False, True]:
                for mode in ['', 'build-fail', 'up-fail']:
                    with self.subTest(engine=engine, inherited=inherited, mode=mode):
                        result, _ = self.run_deploy(mode, existing=False,
                                                   inherited_lock=inherited, check_lifetime=engine)
                        self.assertEqual(result.returncode == 0, mode == '', result.stderr)

    def test_inherited_poller_lock_allows_deployment(self):
        result, data = self.run_deploy(inherited_lock=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(data['recorded'])

    def test_build_failure_keeps_old(self):
        result, data = self.run_deploy('build-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(data['containers'], {'aic-agent-library': 'old'})
        self.assertFalse(any(c[:2] == ['podman', 'stop'] for c in data['calls']))

    def test_release_images_built_and_propagated_before_switch(self):
        result, data = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = data['calls']
        builds = [c for c in calls if c[:2] == ['podman', 'build']]
        self.assertEqual(len(builds), 2)
        runner, app = (c[c.index('-t') + 1] for c in builds)
        self.assertEqual(builds[0][-3:], ['-f', 'Containerfile.pi-runner', '.'])
        self.assertEqual(builds[1][-3:], ['-f', 'Containerfile', '.'])
        self.assertEqual(runner.split(':')[1], app.split(':')[1])
        self.assertTrue(runner.startswith('localhost/pi-runner:' + 'a' * 40 + '-'))
        self.assertEqual(data['compose_images'], [runner, runner])
        checks = [c for c in calls if 'Runner image verified through app socket' in ' '.join(c)]
        self.assertEqual(len(checks), 2)
        pre, post = checks
        self.assertEqual(pre[-2:], [runner, 'runner-id'])
        self.assertIn('PI_RUNNER_IMAGE=' + runner, pre)
        self.assertIn('keep-id:uid=1000,gid=1000', pre)
        self.assertIn('label=disable', pre)
        self.assertTrue(any(v.endswith('/podman/podman.sock:/run/podman/podman.sock') for v in pre))
        self.assertLess(calls.index(pre), calls.index(['podman', 'stop', '--time', '30', 'aic-agent-library']))
        self.assertEqual(post[:5], ['podman', 'exec', 'aic-agent-library', 'node', '-e'])
        self.assertEqual(post[-2:], [runner, 'runner-id'])

    def test_runner_preflight_failures_keep_old_and_do_not_record_success(self):
        for mode in ['runner-missing', 'runner-empty-id', 'runner-socket-fail', 'app-build-fail']:
            with self.subTest(mode=mode):
                result, data = self.run_deploy(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(data['containers'], {'aic-agent-library': 'old'})
                self.assertFalse(any(c[:2] == ['podman', 'stop'] for c in data['calls']))
                self.assertFalse(data['recorded'])

    def test_actual_app_runner_failures_roll_back(self):
        for mode in ['runner-env-mismatch', 'runner-lost']:
            with self.subTest(mode=mode):
                result, data = self.run_deploy(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(data['containers'], {'aic-agent-library': 'old'})
                self.assertIn(['podman', 'start', 'aic-agent-library'], data['calls'])
                self.assertFalse(data['recorded'])

    def test_bad_environment_keeps_old(self):
        result, data = self.run_deploy('env-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[:2] == ['podman', 'stop'] for c in data['calls']))
        self.assertFalse(data['recorded'])

    def test_success_preserves_manual_container(self):
        result, data = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data['containers'], {'aic-agent-library': 'new', 'aic-agent-library-previous': 'old'})
        self.assertTrue(data['recorded'])

    def test_managed_success_removes_backup(self):
        result, data = self.run_deploy('managed')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data['containers'], {'aic-agent-library': 'new'})

    def test_health_failure_restores_old(self):
        result, data = self.run_deploy('health-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(data['containers'], {'aic-agent-library': 'old'})
        self.assertIn(['podman', 'start', 'aic-agent-library'], data['calls'])
        self.assertFalse(data['recorded'])

    def test_partial_compose_failure_restores_old(self):
        result, data = self.run_deploy('up-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(data['containers'], {'aic-agent-library': 'old'})

    def test_first_deploy_failure_removes_candidate(self):
        result, data = self.run_deploy('health-fail', existing=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(data['containers'], {})

if __name__ == '__main__':
    unittest.main()
