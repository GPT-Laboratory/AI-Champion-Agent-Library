import { defineConfig } from 'vitest/config'
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  test: {
    environment: 'node',
    // Full-suite runs are CPU-starved (160+ files in parallel); polling helpers and
    // jsdom/axe tests exceeded the 5s default under load. Generous limits, no assertion changes.
    // D-163 raised these to 30s for load-heavy parallel runs. After the B-003 flake fix (D-443) 15s
    // would likely hold, but that is unmeasured under load; left at 30s on purpose.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Tests must never resolve or download a real embedding model.
    env: { SEARCH_EMBEDDINGS: 'off' },
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/lib/components/**/*.test.ts', 'jsdom'],
    ],
  },
})
