// Executed with node -e in the app image before switching and in the new app.
// dockerode is a production dependency; use the same API and socket as Try It Out.
const Docker = require('dockerode');
const [expectedImage, expectedId] = process.argv.slice(1);
const socketPath = '/run/podman/podman.sock';
const id = value => String(value || '').replace(/^sha256:/, '');
async function validate() {
  if (!expectedImage || !expectedId) throw new Error('Expected runner image and ID are required');
  if (process.env.PI_RUNNER_IMAGE !== expectedImage)
    throw new Error(`PI_RUNNER_IMAGE mismatch: expected ${expectedImage}, got ${process.env.PI_RUNNER_IMAGE || '(unset)'}`);
  if (process.env.PI_RUNNER_SOCKET !== socketPath)
    throw new Error(`PI_RUNNER_SOCKET must be ${socketPath}`);
  const docker = new Docker({ socketPath, timeout: 10000 });
  const image = await docker.getImage(expectedImage).inspect();
  if (id(image.Id) !== id(expectedId))
    throw new Error(`Runner image ID mismatch for ${expectedImage}; CLI and app socket must use the same image storage`);
  console.log(`Runner image verified through app socket: ${expectedImage}`);
}
validate().catch(error => {
  console.error(`Deployment runner check failed: ${error.message}`);
  process.exitCode = 1;
});
