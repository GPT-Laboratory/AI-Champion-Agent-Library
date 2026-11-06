// Minimal MCP-over-stdio stub for transport tests. Plain Node ESM, no dependencies.
// argv flags: hang (never replies, stays alive), stubborn (hang and ignore SIGTERM), noise, exit-early
import { createInterface } from 'node:readline'

const flags = new Set(process.argv.slice(2))
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

if (flags.has('exit-early')) process.exit(3)
if (flags.has('stubborn')) process.on('SIGTERM', () => {})
if (flags.has('hang') || flags.has('stubborn')) {
  setInterval(() => {}, 1000)
  process.stdin.resume()
} else {
  if (flags.has('noise')) process.stdout.write('stub starting up\n')
  process.stderr.write('stub: ready\n')
  const tools = [{ name: 'echo_env_keys', description: 'Names of env vars visible to the server', inputSchema: { type: 'object' } }]
  createInterface({ input: process.stdin }).on('line', (line) => {
    let m
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    if (m.id === undefined) return
    if (m.method === 'initialize') {
      out({
        jsonrpc: '2.0',
        id: m.id,
        result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0' } }
      })
    } else if (m.method === 'tools/list') {
      out({ jsonrpc: '2.0', id: m.id, result: { tools } })
    } else if (m.method === 'tools/call') {
      const text = m.params?.name === 'echo_env_keys' ? Object.keys(process.env).sort().join(',') : 'ok'
      out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } })
    } else {
      out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } })
    }
  })
}
