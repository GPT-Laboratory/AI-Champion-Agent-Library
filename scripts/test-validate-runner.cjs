// No dependencies or engine required: exercise the exact deployed Node script.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../deploy/validate-runner.cjs'), 'utf8');
const image = 'localhost/pi-runner:release-123';
async function check({ env = {}, argv = [image, 'abc'], imageId = 'sha256:abc', error } = {}) {
  const calls = [];
  const messages = [];
  const process = {
    env: { PI_RUNNER_IMAGE: image, PI_RUNNER_SOCKET: '/run/podman/podman.sock', ...env },
    argv: ['node', ...argv], exitCode: 0,
  };
  class Docker {
    constructor(options) { calls.push(options); }
    getImage(tag) {
      calls.push(tag);
      return { inspect: async () => { if (error) throw error; return { Id: imageId }; } };
    }
  }
  vm.runInNewContext(source, {
    process, require: name => { assert.equal(name, 'dockerode'); return Docker; },
    console: { log: message => messages.push(message), error: message => messages.push(message) },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { process, calls, messages: messages.join('\n') };
}
test('inspects the release image through the app socket and normalizes ID prefixes', async () => {
  const result = await check();
  assert.equal(result.process.exitCode, 0);
  assert.equal(result.calls[0].socketPath, '/run/podman/podman.sock');
  assert.equal(result.calls[0].timeout, 10000);
  assert.equal(result.calls[1], image);
});
test('rejects stale, blank, unset and latest environment images before contacting the engine', async () => {
  for (const value of ['localhost/pi-runner:latest', 'localhost/pi-runner:old', '', undefined]) {
    const result = await check({ env: { PI_RUNNER_IMAGE: value } });
    assert.equal(result.process.exitCode, 1);
    assert.match(result.messages, /PI_RUNNER_IMAGE mismatch/);
    assert.equal(result.calls.length, 0);
  }
});
test('rejects wrong socket, missing expected arguments and mismatched image storage', async () => {
  for (const options of [{ env: { PI_RUNNER_SOCKET: '/wrong.sock' } }, { argv: [] }, { imageId: 'different' }, { imageId: '' }]) {
    assert.equal((await check(options)).process.exitCode, 1);
  }
});
test('fails on missing images and inaccessible sockets', async () => {
  for (const message of ['HTTP 404: image not known', 'connect EACCES', 'connect ECONNREFUSED', 'request timed out']) {
    const result = await check({ error: new Error(message) });
    assert.equal(result.process.exitCode, 1);
    assert.ok(result.messages.includes(message));
  }
});
