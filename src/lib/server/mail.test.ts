import { describe, expect, it, vi } from 'vitest'
import { createLoginCodeMailer } from './mail'

describe('createLoginCodeMailer', () => {
  it('uses Brevo by default when SMTP_SERVER is not configured', async () => {
    const smtpSend = vi.fn(async () => {})
    const brevoSend = vi.fn(async () => {})
    const smtp = vi.fn(() => smtpSend)
    const brevo = vi.fn(() => brevoSend)

    const send = createLoginCodeMailer(
      {
        brevoApiKey: 'brevo-key',
        senderEmail: 'library@example.org',
        senderName: 'AIC Agent Library',
      },
      { smtp, brevo },
    )
    await send('member@example.org', '123456')

    expect(brevo).toHaveBeenCalledWith({
      apiKey: 'brevo-key',
      senderEmail: 'library@example.org',
      senderName: 'AIC Agent Library',
    })
    expect(brevoSend).toHaveBeenCalledWith('member@example.org', '123456')
    expect(smtp).not.toHaveBeenCalled()
  })

  it('uses unauthenticated SMTP when SMTP_SERVER is configured', async () => {
    const smtpSend = vi.fn(async () => {})
    const brevoSend = vi.fn(async () => {})
    const smtp = vi.fn(() => smtpSend)
    const brevo = vi.fn(() => brevoSend)

    const send = createLoginCodeMailer(
      {
        smtpServer: 'mail.internal.example.org',
        smtpPort: '2525',
        brevoApiKey: 'unused-brevo-key',
        senderEmail: 'library@example.org',
        senderName: 'AIC Agent Library',
      },
      { smtp, brevo },
    )
    await send('member@example.org', '654321')

    expect(smtp).toHaveBeenCalledWith({
      host: 'mail.internal.example.org',
      port: 2525,
      senderEmail: 'library@example.org',
      senderName: 'AIC Agent Library',
    })
    expect(smtpSend).toHaveBeenCalledWith('member@example.org', '654321')
    expect(brevo).not.toHaveBeenCalled()
  })

  it('rejects an invalid SMTP_PORT before connecting', () => {
    expect(() =>
      createLoginCodeMailer(
        { smtpServer: 'mail.internal.example.org', smtpPort: 'invalid' },
        { smtp: vi.fn(), brevo: vi.fn() },
      ),
    ).toThrow('SMTP_PORT')
  })
})
