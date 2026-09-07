const fs = require('node:fs')
const mode = process.env.FAKE_MODE
fs.writeFileSync(process.env.FAKE_LOG + '.pid', String(process.pid))
if (mode === 'stubborn') process.on('SIGTERM', () => {})
let initialized = false
const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\n')
if (mode === 'exit') process.exit(1)
if (mode === 'close-input') { process.stdin.destroy(); setTimeout(() => process.exit(), 50) }
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line)
  fs.appendFileSync(process.env.FAKE_LOG, line + '\n')
  if (mode === 'timeout' || mode === 'stubborn') return
  if (m.method === 'initialize') {
    if (mode === 'init-error') return process.stdout.write(JSON.stringify({ id: m.id, error: { code: -1, message: 'init failed' } }) + '\n')
    return send(m.id, {})
  }
  if (m.method === 'initialized') { initialized = true; return }
  if (!initialized) return
  if (mode === 'list-error') return process.stdout.write(JSON.stringify({ id: m.id, error: { code: -1, message: 'failed' } }) + '\n')
  if (mode === 'malformed') return process.stdout.write('not json\n')
  if (mode === 'bad-result') return send(m.id, { data: 'broken' })
  if (mode === 'single') return send(m.id, { data: [{ id: 'single' }], nextCursor: null })
  send(m.id, { data: [{ id: m.params.cursor ? 'second' : 'first' }], nextCursor: mode === 'loop' || !m.params.cursor ? 'page2' : null })
})
