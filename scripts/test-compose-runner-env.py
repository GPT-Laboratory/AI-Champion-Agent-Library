#!/usr/bin/env python3
"""Render the actual Compose file; no container engine or secrets needed.

Requires podman-compose and its PyYAML dependency. This complements the stubbed
orchestration tests with the installed Compose provider's interpolation behavior.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('podman-compose'), 'podman-compose is not installed')
class ComposeRunnerEnvironmentTests(unittest.TestCase):
    def render(self, shell_image=None, file_image=None):
        import yaml
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # A separate checkout .env must not replace the explicitly selected file.
            (root / '.env').write_text('PI_RUNNER_IMAGE=localhost/pi-runner:checkout-stale\n')
            app_env = root / 'app.env'
            app_env.write_text('ORIGIN=https://example.org\n' +
                               (f'PI_RUNNER_IMAGE={file_image}\n' if file_image is not None else ''))
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            podman = bin_dir / 'podman'
            podman.write_text('#!/bin/sh\necho "podman version 4.9.0"\n')
            podman.chmod(0o755)
            compose = root / 'podman-compose.yml'
            shutil.copy(ROOT / 'podman-compose.yml', compose)
            env = dict(os.environ, XDG_RUNTIME_DIR='/run/user/1000',
                       PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                       APP_ENV_FILE=str(app_env), APP_IMAGE='localhost/app:release-123')
            env.pop('PI_RUNNER_IMAGE', None)
            if shell_image is not None:
                env['PI_RUNNER_IMAGE'] = shell_image
            result = subprocess.run(['podman-compose', '--env-file', str(app_env),
                                     '-p', 'aic-test', '-f', str(compose), 'config'],
                                    cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return yaml.safe_load(result.stdout)['services']['aic-agent-library']['environment']

    def test_deploy_export_overrides_stale_external_env_file(self):
        env = self.render('localhost/pi-runner:release-123', 'localhost/pi-runner:latest')
        self.assertEqual(env['PI_RUNNER_IMAGE'], 'localhost/pi-runner:release-123')
        self.assertEqual(env['PI_RUNNER_SOCKET'], '/run/podman/podman.sock')

    def test_deploy_export_without_file_image(self):
        self.assertEqual(self.render('localhost/pi-runner:release-123')['PI_RUNNER_IMAGE'],
                         'localhost/pi-runner:release-123')

    def test_direct_compose_without_deploy_uses_file_or_development_fallback(self):
        self.assertEqual(self.render(file_image='localhost/pi-runner:old')['PI_RUNNER_IMAGE'],
                         'localhost/pi-runner:old')
        self.assertEqual(self.render()['PI_RUNNER_IMAGE'], 'localhost/pi-runner:latest')


if __name__ == '__main__':
    unittest.main()
