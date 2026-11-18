import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'

// The version in the top bar: the repository's release tag, baked in as import.meta.env.VITE_APP_VERSION. The image
// build sets it from deploy.sh (its context has no .git, so an empty value stays empty); a local checkout asks git.
if (process.env.VITE_APP_VERSION === undefined) {
  try {
    process.env.VITE_APP_VERSION = execFileSync('git', ['describe', '--tags'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim()
  } catch {
    process.env.VITE_APP_VERSION = '' // no git or no tags: no version shown
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
  ],
  server: {
    // Dev only: Pi containers reach the app's LLM proxy as host.containers.internal
    // (README: "Local development with npm run dev"); Vite otherwise blocks that Host header.
    allowedHosts: ['host.containers.internal'],
  },
})
