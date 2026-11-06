#!/usr/bin/env python3
"""Real Git/SSH release-policy tests; uses a stub deploy.sh, never Podman."""
import os
import fcntl
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class SignedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.remote = self.root / 'origin.git'
        self.key = self.root / 'key'
        self.run_cmd('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.key))
        self.run_cmd('git', 'init', '-q', '--bare', str(self.remote))
        self.run_cmd('git', 'init', '-q', '-b', 'main', str(self.repo))
        for key, value in [('user.name', 'Test'), ('user.email', 'test@example.org'),
                           ('gpg.format', 'ssh'), ('user.signingkey', str(self.key))]:
            self.git('config', key, value)
        (self.repo / 'deploy.sh').write_text('#!/bin/bash\necho deployed >> "$HOME/deployments"\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Initial')
        self.git('remote', 'add', 'origin', str(self.remote))
        self.git('push', '-q', 'origin', 'main')
        self.signers = self.root / 'allowed_signers'
        self.signers.write_text('test@example.org namespaces="git" ' + self.key.with_suffix('.pub').read_text())
        self.script = self.root / 'autodeploy'
        self.script.write_text((ROOT / 'deploy/autodeploy').read_text().replace('/etc/autodeploy/allowed_signers', str(self.signers)))
        (self.root / 'app.env').write_text('ORIGIN=https://example.org\n')
        self.env = dict(os.environ, HOME=str(self.root), AUTODEPLOY_REPO=str(self.repo),
                        APP_ENV_FILE=str(self.root / 'app.env'), DEPLOY_STATE_DIR=str(self.root / 'state'))

    def run_cmd(self, *args):
        return subprocess.run(args, check=True, capture_output=True, text=True)

    def git(self, *args):
        return self.run_cmd('git', '-C', str(self.repo), *args)

    def tag(self, name, signed=True):
        self.git('tag', '-s' if signed else '-a', name, '-m', name)
        self.git('push', '-q', 'origin', 'refs/tags/' + name)

    def poll(self):
        return subprocess.run(['bash', str(self.script)], env=self.env, capture_output=True, text=True)

    def test_valid_release_is_only_deployed_once(self):
        self.tag('v1.0.0')
        result = self.poll()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.poll().returncode, 0)
        self.assertEqual((self.root / 'deployments').read_text(), 'deployed\n')

    def test_unsigned_newest_blocks_deployment(self):
        self.tag('v1.0.0')
        self.tag('v2.0.0', signed=False)
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'deployments').exists())

    def test_untrusted_key_blocks_deployment(self):
        self.tag('v1.0.0')
        self.signers.write_text('')
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'deployments').exists())

    def test_tag_outside_main_blocks_deployment(self):
        (self.repo / 'other').write_text('branch change')
        self.git('add', '.')
        self.git('commit', '-qm', 'Not pushed to main')
        self.tag('v1.0.0')
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'deployments').exists())

    def test_mutated_release_is_rejected(self):
        self.tag('v1.0.0')
        self.assertEqual(self.poll().returncode, 0)
        self.git('tag', '-fs', 'v1.0.0', '-m', 'Changed release')
        self.git('push', '-q', '--force', 'origin', 'refs/tags/v1.0.0')
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertEqual((self.root / 'deployments').read_text(), 'deployed\n')

    def test_signed_object_cannot_be_replayed_under_another_name(self):
        self.tag('v1.0.0')
        original = self.git('rev-parse', 'refs/tags/v1.0.0').stdout.strip()
        self.git('update-ref', 'refs/tags/v2.0.0', original)
        self.git('push', '-q', 'origin', 'refs/tags/v2.0.0')
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'deployments').exists())

    def test_v_prefix_matches_proposal(self):
        self.tag('v1.4')
        result = self.poll()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'state/release').read_text().startswith('v1.4 '))

    def test_deleted_only_release_is_rejected(self):
        self.tag('v1.0.0')
        self.assertEqual(self.poll().returncode, 0)
        self.git('push', '-q', 'origin', ':refs/tags/v1.0.0')
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertEqual((self.root / 'deployments').read_text(), 'deployed\n')

    def test_lightweight_tag_is_rejected(self):
        self.git('tag', 'v1.0.0')
        self.git('push', '-q', 'origin', 'refs/tags/v1.0.0')
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'deployments').exists())

    def test_failure_does_not_record_release_and_can_retry(self):
        (self.repo / 'deploy.sh').write_text('#!/bin/bash\n[[ ! -e "$HOME/fail" ]] || exit 1\necho deployed >> "$HOME/deployments"\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Deploy with test failure')
        self.git('push', '-q', 'origin', 'main')
        self.tag('v1.0.0')
        (self.root / 'fail').touch()
        self.assertNotEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'state/release').exists())
        (self.root / 'fail').unlink()
        self.assertEqual(self.poll().returncode, 0)
        self.assertTrue((self.root / 'state/release').exists())

    def test_manual_deployment_lock_prevents_checkout(self):
        self.tag('v1.0.0')
        state = self.root / 'state'
        state.mkdir()
        with (state / 'deploy.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.poll().returncode, 0)
        self.assertFalse((self.root / 'deployments').exists())
        self.assertEqual(self.git('branch', '--show-current').stdout.strip(), 'main')

    def test_lock_is_held_through_deploy(self):
        (self.repo / 'deploy.sh').write_text('#!/bin/bash\nif flock -n "$DEPLOY_STATE_DIR/deploy.lock" -c true; then exit 1; fi\nflock -n 9 || exit 1\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Check inherited lock')
        self.git('push', '-q', 'origin', 'main')
        self.tag('v1.0.0')
        result = self.poll()
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == '__main__':
    unittest.main()
