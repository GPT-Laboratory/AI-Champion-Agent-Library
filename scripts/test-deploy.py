#!/usr/bin/env python3
"""Deployment orchestration tests without a container engine.
Only the /run socket path is substituted in the copied script. Engine commands
are simulated; these tests do not replace a real rootless Podman acceptance run.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MOCK = r'''#!/usr/bin/python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
path = pathlib.Path(os.environ['MOCK_STATE'])
s = json.loads(path.read_text())
s['calls'].append([name] + args)
code = 0
out = ''
mode = os.environ.get('MODE', '')
if name == 'id': out = '1000'
elif name == 'git': out = 'a' * 40
elif name == 'podman-compose':
    if '--no-build' in args:
        s['containers']['aic-agent-library'] = 'new'
        if mode == 'up-fail': code = 1
elif name == 'podman':
    if args[:2] == ['container', 'exists']: code = 0 if args[2] in s['containers'] else 1
    elif args[0] == 'build' and mode == 'build-fail': code = 1
    elif args[0] == 'run' and mode == 'env-fail': code = 1
    elif args[0] == 'rename': s['containers'][args[2]] = s['containers'].pop(args[1])
    elif args[0] == 'rm': s['containers'].pop(args[-1], None)
    elif args[:2] == ['image', 'inspect']: out = 'new'
    elif args[0] == 'inspect':
        if 'Labels' in args[2]: out = 'aic-agent-library' if mode == 'managed' else ''
        else: out = s['containers'][args[-1]]
    elif args[0] == 'exec' and 'fetch(' in args[-1] and mode == 'health-fail': code = 1
path.write_text(json.dumps(s))
if out: print(out)
sys.exit(code)
'''

class DeployTests(unittest.TestCase):
    def run_deploy(self, mode='', existing=True, inherited_lock=False):
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
                (root / '.env').write_text('AUTH_ENABLED=false\nORIGIN=http://localhost:3000\n')
                bin_dir = root / 'bin'
                bin_dir.mkdir()
                for name in ['podman', 'podman-compose', 'git', 'id', 'sleep']:
                    dest = bin_dir / name
                    dest.write_text(MOCK)
                    dest.chmod(0o755)
                state = root / 'mock.json'
                state.write_text(json.dumps({'calls': [], 'containers': {'aic-agent-library': 'old'} if existing else {}}))
                env = dict(os.environ, PATH=str(bin_dir) + ':' + os.environ['PATH'],
                           HOME=str(root), MOCK_STATE=str(state), MODE=mode)
                for key in ['APP_ENV_FILE', 'DEPLOY_STATE_DIR', 'COMPOSE_PROJECT_NAME', 'AIC_DEPLOY_LOCK_FD']:
                    env.pop(key, None)
                command = ['bash', str(root / 'deploy.sh')]
                if inherited_lock:
                    command = ['bash', '-c',
                               'mkdir -p "$HOME/.local/state/aic-deploy"; '
                               'exec 9>"$HOME/.local/state/aic-deploy/deploy.lock"; '
                               'flock -n 9 || exit 1; export AIC_DEPLOY_LOCK_FD=9; exec bash "$1"',
                               'test', str(root / 'deploy.sh')]
                result = subprocess.run(command, env=env, capture_output=True, text=True)
                data = json.loads(state.read_text())
                data['recorded'] = (root / '.local/state/aic-deploy/current').exists()
                return result, data

    def test_inherited_poller_lock_allows_deployment(self):
        result, data = self.run_deploy(inherited_lock=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(data['recorded'])

    def test_build_failure_keeps_old(self):
        result, data = self.run_deploy('build-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(data['containers'], {'aic-agent-library': 'old'})
        self.assertFalse(any(c[:2] == ['podman', 'stop'] for c in data['calls']))

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
