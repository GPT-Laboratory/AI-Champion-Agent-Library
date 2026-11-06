import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { createSmtpMailer } from './smtp'

let server: Server | undefined

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

describe('createSmtpMailer', () => {
  it('sends the login code with SMTP and no authentication commands', async () => {
    const received: string[] = []
    server = createServer((socket) => {
      socket.setEncoding('utf8')
      socket.write('220 test SMTP ready\r\n')
      let buffered = ''
      let readingData = false

      socket.on('data', (chunk) => {
        buffered += String(chunk)
        while (buffered.includes('\r\n')) {
          const end = buffered.indexOf('\r\n')
          const line = buffered.slice(0, end)
          buffered = buffered.slice(end + 2)
          received.push(line)

          if (readingData) {
            if (line === '.') {
              readingData = false
              socket.write('250 message accepted\r\n')
            }
          } else if (line.startsWith('EHLO ')) {
            socket.write('250-test\r\n250 SIZE 1000000\r\n')
          } else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) {
            socket.write('250 OK\r\n')
          } else if (line === 'DATA') {
            readingData = true
            socket.write('354 end with dot\r\n')
          } else if (line === 'QUIT') {
            socket.end('221 bye\r\n')
          }
        }
      })
    })

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test SMTP server has no TCP address')

    const send = createSmtpMailer({
      host: '127.0.0.1',
      port: address.port,
      senderEmail: 'library@example.org',
      senderName: 'AIC Agent Library',
    })
    await send('member@example.org', '123456')

    expect(received).toContain('MAIL FROM:<library@example.org>')
    expect(received).toContain('RCPT TO:<member@example.org>')
    expect(received).toContain('Your one-time AIC Agent Library login code is 123456.')
    expect(received.some((line) => /^AUTH\b/i.test(line))).toBe(false)
  })
})
