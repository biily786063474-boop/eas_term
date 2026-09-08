// One-shot, explicitly approved 4-credit acceptance. Never rerun a paid intent.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createBizoneGenerationGuard } from '../src/main/bizoneGenerationGuard.ts'
import { createBizoneConnector } from '../src/main/bizoneConnector.ts'
import { McpClient } from '../src/main/mcpClient.ts'

const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
if (!process.argv.includes('--approved-four-credits')) throw new Error('Explicit approval required')
const app = option('--bizone-app')
const playwright = option('--playwright-module')
if (!app || !path.isAbsolute(app) || !playwright || !path.isAbsolute(playwright)) throw new Error('Provide absolute --bizone-app and --playwright-module paths')
const { chromium } = await import(pathToFileURL(playwright).href)
const executable = path.join(app, 'Contents/MacOS/笔纵画板')
const server = path.join(app, 'Contents/Resources/app/electron/mcpServer.js')
assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), '1.21.31')
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
for (const file of ['src/main/bizoneGenerationGuard.ts', 'src/main/bizoneConnector.ts', 'src/main/mcpClient.ts']) {
  assert.deepEqual(fs.readFileSync(file), execFileSync('git', ['show', '9510ff2:' + file]), 'Wrong frozen source: ' + file)
}
const output = path.resolve('docs/verification/builtin-capabilities/paid-recovery-9510ff2')
fs.mkdirSync(output, { recursive: true })
const marker = path.join(output, '.one-shot')
fs.writeFileSync(marker, 'Never rerun. Recover the existing request from evidence/private profile.\n', { flag: 'wx', mode: 0o600 })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bizone-paid-recovery-'))
fs.chmodSync(profile, 0o700)
const guardRoot = path.join(profile, 'eas-guard')
fs.mkdirSync(guardRoot, { mode: 0o700 })
const secure = path.join(os.homedir(), 'Library/Application Support/笔纵画板/secure')
fs.mkdirSync(path.join(profile, 'secure'), { mode: 0o700 })
for (const name of fs.readdirSync(secure).filter(n => /^sb-[A-Za-z0-9_-]+-auth-token\.bin$/.test(n))) {
  fs.copyFileSync(path.join(secure, name), path.join(profile, 'secure', name))
  fs.chmodSync(path.join(profile, 'secure', name), 0o600)
}
const evidence = { passed: false, approvedCredits: 4, formalBizoneVersion: '1.21.31', executable,
  sourceCommit: '9510ff29e94b143015691715f3e0bfbe16b1caa7', profile,
  easGuardExecution: 'Production source guard/connector in Node harness; not Eas-Term GUI process',
  fault: 'Real localhost HTTP response connection destroyed after upstream acknowledgment; no fabricated backend responses',
  steps: [], requests: [] }
const save = () => fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
const step = (name, data) => { evidence.steps.push({ name, at: new Date().toISOString(), ...data }); save(); console.log(JSON.stringify({ step: name, ...data })) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const body = r => { const texts = r?.content?.filter(c => c.type === 'text'); assert.equal(texts?.length, 1); return JSON.parse(texts[0].text) }
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_ENV
const log = fs.openSync(path.join(profile, 'app.log'), 'a', 0o600)
const child = spawn(executable, ['--user-data-dir=' + profile, '--remote-debugging-port=0'], { env, stdio: ['ignore', log, log], detached: true })
child.unref()
let browser, proxy, guard, paidStarted = false, completed = false, dropped = false, revision = 0
try {
  let debugPort
  for (let i = 0; i < 600; i++) {
    try { debugPort = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (debugPort) break } catch {}
    if (child.exitCode !== null) throw new Error('Formal Bizone exited before readiness')
    await wait(100)
  }
  assert.ok(debugPort, 'Formal Bizone debugger not ready')
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort)
  const page = browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')
  let endpoint
  for (let i = 0; i < 300; i++) {
    try { endpoint = JSON.parse(fs.readFileSync(path.join(profile, 'api-token.json'), 'utf8')); if (endpoint.port) break } catch {}
    await wait(100)
  }
  assert.ok(endpoint?.token)
  proxy = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const payload = Buffer.concat(chunks)
      let parameters = {}; try { parameters = JSON.parse(payload.toString()) } catch {}
      const name = req.url.split('/').at(-1)
      evidence.requests.push({ name, requestId: parameters.requestId ?? null, at: new Date().toISOString() }); save()
      const upstream = http.request({ hostname: '127.0.0.1', port: endpoint.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:' + endpoint.port } }, incoming => {
        if (name === 'generate_now' && !dropped) {
          dropped = true; revision++
          incoming.resume(); res.destroy()
          step('response-connection-dropped', { httpStatus: incoming.statusCode, requestId: parameters.requestId })
        } else { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res) }
      })
      upstream.on('error', () => res.destroy())
      upstream.end(payload)
    })
  })
  await new Promise(r => proxy.listen(0, '127.0.0.1', r))
  const tokenFile = path.join(profile, 'proxy-token.json')
  fs.writeFileSync(tokenFile, JSON.stringify({ port: proxy.address().port, token: endpoint.token }), { mode: 0o600 })
  const makeGuard = () => createBizoneGenerationGuard({ appOwnedDataDir: guardRoot, underlying: createBizoneConnector({
    version: '0.4.85', backend: { ensureRunning: async () => ({ revision: String(revision) }) },
    createClient: () => new McpClient({ name: 'paid-recovery', command: process.execPath, args: [server], cwd: path.dirname(server),
      env: { PATH: process.env.PATH, HOME: os.homedir(), TAPTV_TOKEN_FILE: tokenFile } })
  }) })
  guard = makeGuard()
  const context = { project: profile, agentSessionId: 'paid-recovery-acceptance' }
  const call = async (name, args = {}) => body(await guard.call(name, args, context, () => {}))
  const catalog = await guard.tools()
  assert.ok(catalog.some(t => t.name === 'get_generation_request'))
  let billing
  for (let i = 0; i < 60; i++) { billing = await call('get_user_billing_tier'); if (billing.shouldUseBzone && billing.totalCredits >= 4) break; await wait(1000) }
  assert.ok(billing.shouldUseBzone && billing.totalCredits >= 4, 'Isolated authenticated account unavailable')
  evidence.balanceBefore = billing.totalCredits
  const project = await call('create_project', { name: 'Eas-Term 0.4.85 付费断线验收' })
  const node = await call('add_node', { type: 'image', title: '4墨水·单次请求断线验收' })
  evidence.project = project; evidence.node = node; save()
  const nodeId = node.nodeId ?? node.id ?? node.node?.id
  assert.equal(typeof nodeId, 'string')
  const models = await call('list_models', { type: 'image' })
  assert.ok(JSON.stringify(models).includes('z-image-turbo'))
  const quote = await call('generate', { nodeId, modelId: 'z-image-turbo', quality: '1k', ratio: '1:1',
    prompt: 'A single blue square centered on a plain white background. Minimal test image, no text.', requestId: 'eas-quote-' + crypto.randomUUID() })
  step('quote', { quote })
  assert.equal(quote.estimate?.credits, 4, 'Changed quote: do not generate')
  assert.equal(typeof quote.easOperationId, 'string')
  evidence.executionId = quote.easOperationId; paidStarted = true; save()
  const result = await call('generate_now', { nodeId, requestId: quote.easOperationId })
  step('recovered-after-response-loss', { result })
  assert.equal(dropped, true)
  assert.equal(result._request?.state, 'acknowledged')
  assert.equal(result._request.requestId, quote.easOperationId)
  assert.equal(result.ok, true)
  guard.close(); revision++; guard = makeGuard()
  const recovered = await call('generate_now', { nodeId, requestId: quote.easOperationId })
  step('guard-restarted-reconciled', { result: recovered })
  assert.equal(recovered._request?.requestId, quote.easOperationId)
  assert.equal(evidence.requests.filter(r => r.name === 'generate_now').length, 1)
  let status
  for (let i = 0; i < 180; i++) {
    status = await call('get_generation_status', { nodeId })
    if (['done', 'error'].includes(status.status)) break
    await wait(2000)
  }
  step('generation-finished', { status: status.status, error: status.error })
  completed = ['done', 'error'].includes(status.status)
  const finalNode = await call('get_node', { nodeId })
  evidence.finalNode = finalNode
  await call('save_project')
  const after = await call('get_user_billing_tier')
  evidence.balanceAfter = after.totalCredits; evidence.balanceDelta = evidence.balanceBefore - evidence.balanceAfter
  evidence.upstreamReceipt = await call('get_generation_request', { requestId: quote.easOperationId })
  assert.equal(evidence.upstreamReceipt.state, 'acknowledged')
  await page.screenshot({ path: path.join(output, 'application-state.png') })
  evidence.paidHttpSubmissions = evidence.requests.filter(r => r.name === 'generate_now').length
  evidence.reconciliationPassed = evidence.paidHttpSubmissions === 1
  assert.equal(status.status, 'done', 'Provider did not produce an image; do not automatically submit again')
  assert.equal(evidence.balanceDelta, 4)
  evidence.passed = true; step('passed', { paidHttpSubmissions: 1, balanceDelta: 4 })
} catch (error) {
  evidence.error = String(error?.message ?? error); save(); console.error(evidence.error); process.exitCode = 1
} finally {
  guard?.close(); await browser?.close(); proxy?.close(); proxy?.closeAllConnections()
  if (!paidStarted || completed) {
    child.kill('SIGTERM'); evidence.ownedAppStopRequested = true
    for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await wait(100)
    evidence.ownedAppExitConfirmed = child.exitCode !== null || child.signalCode !== null
    if (evidence.ownedAppExitConfirmed) {
      for (const name of fs.readdirSync(path.join(profile, 'secure')).filter(n => /^sb-[A-Za-z0-9_-]+-auth-token\.bin$/.test(n))) fs.unlinkSync(path.join(profile, 'secure', name))
      evidence.copiedEncryptedAuthRemovedAfterExit = true
    } else { evidence.passed = false; evidence.cleanupError = 'Owned app did not exit; encrypted auth retained for recovery'; process.exitCode = 1 }
  }
  else evidence.ownedAppLeftRunningForRecovery = true
  save(); fs.closeSync(log)
}
