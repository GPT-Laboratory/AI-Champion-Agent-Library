#!/usr/bin/env python3
"""Notification tests with a local curl double; never publishes messages."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class NotifyTests(unittest.TestCase):
    def run_notify(self, url='', curl_status=0):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            curl = root / 'curl'
            curl.write_text('#!/bin/sh\ncat > "$CAPTURE"\nexit "$CURL_STATUS"\n')
            curl.chmod(0o755)
            capture = root / 'body'
            env = dict(os.environ, PATH=str(root) + ':' + os.environ['PATH'],
                       NTFY_URL=url, CURL_STATUS=str(curl_status), CAPTURE=str(capture))
            env.pop('NTFY_TOKEN', None)
            result = subprocess.run(['bash', str(ROOT / 'deploy/autodeploy-notify')],
                                    env=env, capture_output=True, text=True)
            return result, capture.read_text() if capture.exists() else None

    def test_unconfigured_does_not_send(self):
        result, body = self.run_notify()
        self.assertEqual(result.returncode, 0)
        self.assertIsNone(body)

    def test_https_message_contains_no_raw_logs(self):
        result, body = self.run_notify('https://ntfy.example.org/test')
        self.assertEqual(result.returncode, 0)
        self.assertIn('Check: journalctl -u autodeploy.service', body)
        self.assertEqual(len(body.splitlines()), 1)

    def test_rejects_plain_http(self):
        result, body = self.run_notify('http://ntfy.example.org/test')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(body)

    def test_http_failure_propagates(self):
        result, _ = self.run_notify('https://ntfy.example.org/test', curl_status=22)
        self.assertEqual(result.returncode, 22)

if __name__ == '__main__':
    unittest.main()
