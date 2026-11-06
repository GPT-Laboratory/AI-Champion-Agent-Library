import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

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
