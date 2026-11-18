// @vitest-environment jsdom
// The release tag next to "AIC Agent Library" in the top bar: shown when the build has one, absent otherwise, and
// passed from deploy.sh into the image build (the build context has no .git).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readFileSync } from 'node:fs'
import Layout from './+layout.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const empty = createRawSnippet(() => ({ render: () => '<p>page</p>' }))
const mount = () => render(Layout, { props: { data: { user: null }, children: empty } as never })

afterEach(() => vi.unstubAllEnvs())

describe('top bar version', () => {
  it('shows the release tag next to the library name, and passes axe', async () => {
    vi.stubEnv('VITE_APP_VERSION', 'v1.4.8')
    const { container } = mount()
    const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement
    const name = Array.from(nav.querySelectorAll('a')).find((a) => a.textContent === 'AIC Agent Library')!
    expect(name.parentElement?.querySelector('[data-testid="app-version"]')?.textContent).toBe('v1.4.8')
    await expectNoAxeViolations(container)
  })

  it('shows nothing when the build has no version', () => {
    vi.stubEnv('VITE_APP_VERSION', '')
    expect(mount().container.querySelector('[data-testid="app-version"]')).toBeNull()
  })
})

describe('version plumbing', () => {
  it('deploy.sh passes git describe --tags as a build arg to the app image, before -f Containerfile', () => {
    const sh = readFileSync('deploy.sh', 'utf8')
    expect(sh).toMatch(/app_version=\$\(git describe --tags 2>\/dev\/null \|\| true\)/)
    expect(sh).toMatch(/podman build -t "\$APP_IMAGE" --build-arg APP_VERSION="\$app_version" -f Containerfile \.\n/)
  })

  it('the Containerfile turns it into VITE_APP_VERSION before vite build', () => {
    const cf = readFileSync('Containerfile', 'utf8')
    const arg = cf.indexOf('ARG APP_VERSION=')
    const env = cf.indexOf('ENV VITE_APP_VERSION=$APP_VERSION')
    const build = cf.indexOf('npx --no-install vite build')
    const runtime = cf.indexOf('AS runtime')
    expect(arg).toBeGreaterThan(0)
    expect(arg < env && env < build && build < runtime).toBe(true)
  })
})
