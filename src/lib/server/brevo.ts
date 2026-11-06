type Fetch = typeof fetch

type BrevoOptions = {
  apiKey: string
  senderEmail: string
  senderName: string
  fetchImpl?: Fetch
}

export function createBrevoMailer(options: BrevoOptions) {
  return async (recipient: string, code: string): Promise<void> => {
    if (!options.apiKey || !options.senderEmail) {
      throw new Error('BREVO_API_KEY and AUTH_EMAIL_FROM must be configured')
    }

    const response = await (options.fetchImpl ?? fetch)('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': options.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: options.senderEmail, name: options.senderName },
        to: [{ email: recipient }],
        subject: 'Your AIC Agent Library login code',
        textContent: `Your one-time AIC Agent Library login code is ${code}. It expires in 10 minutes.`,
        htmlContent: `<p>Your one-time AIC Agent Library login code is:</p><p style="font-size: 28px; font-weight: 700; letter-spacing: 0.25em">${code}</p><p>It expires in 10 minutes.</p>`,
      }),
    })

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 500)
      throw new Error(`Brevo returned HTTP ${response.status}: ${responseText}`)
    }
  }
}

export async function sendLoginCodeWithBrevo(recipient: string, code: string): Promise<void> {
  const mailer = createBrevoMailer({
    apiKey: env.BREVO_API_KEY ?? '',
    senderEmail: env.AUTH_EMAIL_FROM ?? '',
    senderName: env.AUTH_EMAIL_FROM_NAME ?? 'AIC Agent Library',
  })
  await mailer(recipient, code)
}
import { env } from '$env/dynamic/private'
