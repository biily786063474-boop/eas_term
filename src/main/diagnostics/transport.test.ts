import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { makeReport } from './core.ts'
import { sendReport, sendWithConsent } from './transport.ts'
const report = makeReport({ version: '0.4.85-diag.1', os: '10.0', arch: 'x64' }, [])
test('cancelled consent never invokes transport', async () => {
  let called = 0
  const result = await sendWithConsent(report, async () => false, async () => { called++; return report.id })
  assert.equal(called, 0); assert.equal(result, null)
})
test('upload uses gzip, validates receipt ID and never follows redirects', async () => {
  let mode = 'ok', hits = 0
  const server = http.createServer((req, res) => {
    hits++; assert.equal(req.headers['content-encoding'], 'gzip')
    req.resume(); req.on('end', () => {
      if (mode === 'redirect') { res.writeHead(302, { location: '/other' }); res.end(); return }
      if (mode === 'hang') return
      res.end(JSON.stringify({ ok: true, id: mode === 'wrong' ? 'bad' : report.id }))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}/diagnostics/v1/reports`
  try {
    await assert.rejects(sendReport(report, { url }), /HTTPS/)
    assert.equal(await sendReport(report, { url, allowLoopback: true }), report.id)
    mode = 'redirect'; const before = hits
    await assert.rejects(sendReport(report, { url, allowLoopback: true }), /HTTP/)
    assert.equal(hits, before + 1)
    mode = 'wrong'; await assert.rejects(sendReport(report, { url, allowLoopback: true }), /receipt/)
    mode = 'hang'; await assert.rejects(sendReport(report, { url, allowLoopback: true, timeout: 50 }), /timeout/)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})
