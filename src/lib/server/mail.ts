import { env } from '$env/dynamic/private'
import { createBrevoMailer } from './brevo'
import { createSmtpMailer } from './smtp'

type Mailer = (recipient: string, code: string) => Promise<void>

type MailConfig = {
  smtpServer?: string
  smtpPort?: string
  brevoApiKey?: string
  senderEmail?: string
  senderName?: string
}

type MailerFactories = {
  smtp: (options: { host: string; port: number; senderEmail: string; senderName: string }) => Mailer
  brevo: (options: { apiKey: string; senderEmail: string; senderName: string }) => Mailer
}

const defaultFactories: MailerFactories = {
  smtp: createSmtpMailer,
  brevo: createBrevoMailer,
}

function smtpPort(value: string | undefined): number {
  if (!value?.trim()) return 25
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535')
  }
  return port
}

export function createLoginCodeMailer(
  config: MailConfig,
  factories: MailerFactories = defaultFactories,
): Mailer {
  const senderEmail = config.senderEmail?.trim() ?? ''
  const senderName = config.senderName?.trim() || 'AIC Agent Library'
  const server = config.smtpServer?.trim()

  if (server) {
    return factories.smtp({
      host: server,
      port: smtpPort(config.smtpPort),
      senderEmail,
      senderName,
    })
  }

  return factories.brevo({
    apiKey: config.brevoApiKey ?? '',
    senderEmail,
    senderName,
  })
}

export async function sendLoginCode(recipient: string, code: string): Promise<void> {
  const mailer = createLoginCodeMailer({
    smtpServer: env.SMTP_SERVER,
    smtpPort: env.SMTP_PORT,
    brevoApiKey: env.BREVO_API_KEY,
    senderEmail: env.AUTH_EMAIL_FROM,
    senderName: env.AUTH_EMAIL_FROM_NAME,
  })
  await mailer(recipient, code)
}
