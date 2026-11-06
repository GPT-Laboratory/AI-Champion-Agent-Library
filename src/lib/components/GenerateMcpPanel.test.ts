// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import GenerateMcpPanel from './GenerateMcpPanel.svelte'
import { MAX_INPUT_BYTES } from '$lib/mcpgen/api-contract'

function zipResponse(name?: string) {
  return new Response(new Uint8Array([80, 75]), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      ...(name ? { 'content-disposition': `attachment; filename="${name}"` } : {}),
    },
  })
}

function setup(fetchFn: typeof fetch, onclose = vi.fn()) {
  render(GenerateMcpPanel, { props: { fetchFn, onclose } })
  return { onclose }
}

async function submitText(text: string) {
  const ta = screen.getByLabelText('Schema or spec text') as HTMLTextAreaElement
  await fireEvent.input(ta, { target: { value: text } })
  await fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false))
  await tick()
  return ta
}

describe('GenerateMcpPanel', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  it('renders labelled region, notice, adapter select and live regions', () => {
    setup(vi.fn() as unknown as typeof fetch)
    expect(screen.getByRole('region', { name: 'Generate MCP server' })).toBeTruthy()
    expect(
      screen.getByText('Paste a schema or spec only. Do not paste API keys, passwords or data rows; they are rejected.')
    ).toBeTruthy()
    const select = screen.getByLabelText('Adapter') as HTMLSelectElement
    expect(select.options[0].textContent).toBe('Auto-detect')
    expect(select.options.length).toBeGreaterThan(1)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('Schema or spec text').getAttribute('aria-describedby')).toBeTruthy()
  })

  it('rejects empty and oversized input without a request', async () => {
    const fetchFn = vi.fn()
    setup(fetchFn as unknown as typeof fetch)
    await fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await tick()
    expect(screen.getByRole('alert').textContent).toContain('Paste a schema or spec first')
    await submitText('a'.repeat(MAX_INPUT_BYTES + 1))
    expect(screen.getByRole('alert').textContent).toContain('Input is too large (limit 256 KB)')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('posts JSON, downloads the zip, announces it and clears the textarea', async () => {
    const fetchFn = vi.fn(async () => zipResponse('my-server.zip'))
    setup(fetchFn as unknown as typeof fetch)
    const select = screen.getByLabelText('Adapter') as HTMLSelectElement
    await fireEvent.change(select, { target: { value: 'openapi' } })
    const ta = await submitText('{"openapi":"3.0.0"}')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/mcp-generate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ adapter: 'openapi', input: '{"openapi":"3.0.0"}' })
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Download started')
    expect(ta.value).toBe('')
  })

  it('falls back to mcp-server.zip when no content-disposition', async () => {
    const names: string[] = []
    HTMLAnchorElement.prototype.click = vi.fn(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    setup(vi.fn(async () => zipResponse()) as unknown as typeof fetch)
    await submitText('x')
    expect(names).toEqual(['mcp-server.zip'])
  })

  it('shows gaps as code: message without echoing the input', async () => {
    const secret = 'SUPERSECRETINPUT'
    const body = { ok: false, gaps: [{ code: 'credential-detected', message: 'Input looks like a credential', severity: 'error' }] }
    setup(
      vi.fn(async () => new Response(JSON.stringify(body), { status: 422, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    )
    const ta = await submitText(secret)
    expect(screen.getByRole('alert').textContent).toContain('credential-detected: Input looks like a credential')
    expect(screen.getByRole('alert').textContent).not.toContain(secret)
    expect(ta.value).toBe(secret) // kept so the author can fix it; never rendered elsewhere
  })

  it('handles 404 and network failure', async () => {
    setup(vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)
    await submitText('x')
    expect(screen.getByRole('alert').textContent).toContain('Generate MCP is not available')
  })

  it('network failure shows a generic message', async () => {
    setup(
      vi.fn(async () => {
        throw new Error('boom')
      }) as unknown as typeof fetch
    )
    await submitText('x')
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the generator')
    expect(screen.getByRole('alert').textContent).not.toContain('boom')
  })

  it('Escape and Close call onclose', async () => {
    const { onclose } = setup(vi.fn() as unknown as typeof fetch)
    await fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' })
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onclose).toHaveBeenCalledTimes(2)
  })

  it('uses no browser storage', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/components/GenerateMcpPanel.svelte'), 'utf8')
    for (const t of ['localStorage', 'sessionStorage', 'document.cookie']) expect(src).not.toContain(t)
  })
})
