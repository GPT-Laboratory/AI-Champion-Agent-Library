// Synthetic MCP server over stdio (newline-delimited JSON-RPC). Test fixture only; no real data.
import { createInterface } from 'node:readline'

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
process.stderr.write('fake server stderr noise LVI_API_KEY=should-never-be-logged\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } } })
  }
  if (m.id === undefined) return // notification
  if (m.method !== 'tools/call') return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no' } })
  const { name, arguments: a = {} } = m.params
  if (a._mode === 'exit') process.exit(1)
  if (a._mode === 'hang') return
  if (a._mode === 'error') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'synthetic tool error' }], isError: true } })
  if (a._mode === 'big') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'B'.repeat(500 * 1024) }] } })
  if (a._mode === 'env') return send({ jsonrpc: '2.0', id: m.id, result: { content: [], structuredContent: { _synthetic: true, env: Object.keys(process.env).sort() } } })
  send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ _synthetic: true, tool: name, args: a }) }], structuredContent: { _synthetic: true, tool: name, args: a } } })
})
