import { describe, expect, it, vi } from 'vitest'
import { createBrevoMailer } from './brevo'

describe('createBrevoMailer', () => {
  it('sends the one-time code through the Brevo transactional email API', async () => {
    let capturedRequest: { input: string | URL | Request; init?: RequestInit } | undefined
    const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedRequest = { input, init }
      return new Response(JSON.stringify({ messageId: 'test-id' }), { status: 201 })
    })
    const send = createBrevoMailer({
      apiKey: 'secret-test-key',
      senderEmail: 'library@example.org',
      senderName: 'AIC Agent Library',
      fetchImpl,
    })

    await send('member@example.org', '123456')

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(capturedRequest?.input).toBe('https://api.brevo.com/v3/smtp/email')
    expect(capturedRequest?.init?.headers).toMatchObject({ 'api-key': 'secret-test-key' })
    expect(JSON.parse(String(capturedRequest?.init?.body))).toMatchObject({
      sender: { email: 'library@example.org', name: 'AIC Agent Library' },
      to: [{ email: 'member@example.org' }],
      subject: 'Your AIC Agent Library login code',
    })
    expect(String(capturedRequest?.init?.body)).toContain('123456')
  })

  it('rejects missing Brevo configuration before making a request', async () => {
    const fetchImpl = vi.fn()
    const send = createBrevoMailer({ apiKey: '', senderEmail: '', senderName: 'AIC', fetchImpl })

    await expect(send('member@example.org', '123456')).rejects.toThrow('must be configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
