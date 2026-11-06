import { hostname } from 'node:os'
import { createConnection, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

type SmtpOptions = {
  host: string
  port?: number
  senderEmail: string
  senderName: string
  timeoutMs?: number
}

type SmtpResponse = {
  code: number
  lines: string[]
}

function validEmail(value: string): boolean {
  return /^[^\s<>@\r\n]+@[^\s<>@\r\n]+$/.test(value)
}

function encodedHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('SMTP header values must not contain line breaks')
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function dotStuff(value: string): string {
  return value.replace(/(^|\r\n)\./g, '$1..')
}

async function readResponse(lines: AsyncIterator<string>): Promise<SmtpResponse> {
  const responseLines: string[] = []
  let responseCode: number | undefined

  while (true) {
    const next = await lines.next()
    if (next.done) throw new Error('SMTP server closed the connection unexpectedly')

    const line = next.value
    const match = /^(\d{3})([ -])(.*)$/.exec(line)
    if (!match) throw new Error(`SMTP server returned an invalid response: ${line}`)

    const code = Number(match[1])
    responseCode ??= code
    if (code !== responseCode) throw new Error(`SMTP server returned an inconsistent response: ${line}`)
    responseLines.push(line)

    if (match[2] === ' ') return { code, lines: responseLines }
  }
}

function expectCode(response: SmtpResponse, expected: number[], command: string): void {
  if (!expected.includes(response.code)) {
    throw new Error(`SMTP ${command} failed with ${response.code}: ${response.lines.join(' | ')}`)
  }
}

async function command(
  socket: Socket,
  lines: AsyncIterator<string>,
  value: string,
  expected: number[],
): Promise<void> {
  socket.write(`${value}\r\n`)
  expectCode(await readResponse(lines), expected, value.split(' ', 1)[0])
}

export function createSmtpMailer(options: SmtpOptions) {
  return async (recipient: string, code: string): Promise<void> => {
    const host = options.host.trim()
    const port = options.port ?? 25
    if (!host) throw new Error('SMTP_SERVER must be configured')
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('SMTP_PORT must be an integer between 1 and 65535')
    }
    if (!validEmail(options.senderEmail)) throw new Error('AUTH_EMAIL_FROM must be a valid email address')
    if (!validEmail(recipient)) throw new Error('SMTP recipient must be a valid email address')
    if (!/^\d{6}$/.test(code)) throw new Error('Login code must contain exactly six digits')

    const socket = createConnection({ host, port })
    socket.setTimeout(options.timeoutMs ?? 10_000, () => {
      socket.destroy(new Error('SMTP connection timed out'))
    })

    let reader: ReturnType<typeof createInterface> | undefined
    try {
      await once(socket, 'connect')
      reader = createInterface({ input: socket, crlfDelay: Infinity })
      const lines = reader[Symbol.asyncIterator]()

      expectCode(await readResponse(lines), [220], 'greeting')
      const clientName = hostname().replace(/[^a-zA-Z0-9.-]/g, '-') || 'localhost'
      await command(socket, lines, `EHLO ${clientName}`, [250])
      await command(socket, lines, `MAIL FROM:<${options.senderEmail}>`, [250])
      await command(socket, lines, `RCPT TO:<${recipient}>`, [250, 251])
      await command(socket, lines, 'DATA', [354])

      const body = `Your one-time AIC Agent Library login code is ${code}.\r\n\r\nIt expires in 10 minutes.`
      const message = [
        `From: ${encodedHeader(options.senderName)} <${options.senderEmail}>`,
        `To: <${recipient}>`,
        'Subject: Your AIC Agent Library login code',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        body,
      ].join('\r\n')

      socket.write(`${dotStuff(message)}\r\n.\r\n`)
      expectCode(await readResponse(lines), [250], 'message body')
      socket.write('QUIT\r\n')
    } finally {
      reader?.close()
      socket.destroy()
    }
  }
}
