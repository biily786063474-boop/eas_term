#!/usr/bin/env node
// Actual packaged app -> native CLI model -> MCP -> renderer. NEVER installs fake transports.
// Requires deliberate model-call opt-in. Profiles contain credentials; never attach them to reports.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ompCanvasProof } from './builtin-cli-evidence.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1] }
if (args.includes('--help')) {
  console.log('node scripts/verify-builtin-cli-package.mjs --executable <packaged executable> --cli claude|codex|omp --allow-real-model-calls [--tool canvas_open_image|canvas_open_file] [--model <id>] [--profile <owned verification profile>] [--omp-source-profile <Eas userData>] [--restart] [--timeout-ms 240000] [--output <directory>]\nMac sandbox prevents writes to real global rules/config while allowing CLI authentication and native session persistence. --restart additionally relaunches this exact package/profile and resumes again. Profile is retained (0600 marker) for recovery and contains copied credentials. Windows requires a separate isolated OS user; this runner currently fails closed there.')
  process.exit(0)
}
if (!args.includes('--allow-real-model-calls')) throw new Error('Refusing model calls: explicitly pass --allow-real-model-calls')
const executable = option('--executable'), cli = option('--cli')
const requestedTool = option('--tool') ?? 'canvas_open_image'
if (!['canvas_open_image', 'canvas_open_file'].includes(requestedTool)) throw new Error('Unsupported verification tool')
if (!executable || !path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error('Provide an absolute packaged executable')
if (!['claude', 'codex', 'omp'].includes(cli)) throw new Error('Select --cli claude|codex|omp')
if (process.platform !== 'darwin') throw new Error('This runner requires macOS sandbox protection; Windows acceptance needs an isolated OS-user runner')
const timeout = Number(option('--timeout-ms') ?? 240000)
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('Invalid timeout')
const profile = path.resolve(option('--profile') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cli-package-')))
const marker = path.join(profile, '.builtin-cli-verification.json')
if (fs.existsSync(profile) && fs.readdirSync(profile).length && !fs.existsSync(marker)) throw new Error('Refusing non-verification profile')
fs.mkdirSync(profile, { recursive: true, mode: 0o700 })
fs.chmodSync(profile, 0o700)
fs.writeFileSync(marker, JSON.stringify({ cli, purpose: 'isolated packaged real CLI verification' }), { mode: 0o600 })
const projectDirectory = path.join(profile, '测试项目 with spaces')
fs.mkdirSync(projectDirectory, { recursive: true })
const project = fs.realpathSync(projectDirectory)
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id:'verification-project', name:'CLI 验证', path:project }]), { mode:0o600 })
const output = path.resolve(option('--output') ?? path.join(root, 'docs/verification/builtin-capabilities', `actual-${cli}-${Date.now()}`))
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
// Optional credentials copy is an SQLite consistent snapshot, not a raw copy of a live WAL database.
const ompSource = option('--omp-source-profile')
if (ompSource) {
  if (cli !== 'omp') throw new Error('--omp-source-profile only applies to omp')
  const source = path.join(path.resolve(ompSource), 'omp', 'agent', 'agent.db')
  const destination = path.join(profile, 'omp', 'agent', 'agent.db')
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  execFileSync('python3', ['-c', 'import sqlite3,sys,pathlib\ns=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)\nd=sqlite3.connect(sys.argv[2])\ns.backup(d)\nd.close()\ns.close()', source, destination], { stdio: ['ignore', 'ignore', 'pipe'] })
  fs.chmodSync(destination, 0o600)
  const sourceSetup = path.join(path.resolve(ompSource), 'omp-setup.json')
  if (fs.existsSync(sourceSetup)) {
    const setup = JSON.parse(fs.readFileSync(sourceSetup, 'utf8'))
    const provider = setup.provider
    if (provider && typeof provider.id === 'string') fs.writeFileSync(path.join(profile, 'omp-setup.json'),
      JSON.stringify({ provider: { id: provider.id, ...(typeof provider.model === 'string' ? { model: provider.model } : {}),
        ...(typeof provider.thinking === 'string' ? { thinking: provider.thinking } : {}) } }), { mode: 0o600 })
  }
}
// Tiny PNG fixtures require no image generation service and are each distinct paths.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const files = ['new', 'resume', 'restart'].map(name => { const file = path.join(project, `${cli}-${name}-${Date.now()}.png`); fs.writeFileSync(file, png); return file })
const globalRules = ['.codex/config.toml', '.codex/AGENTS.md', '.claude.json', '.claude/settings.json', '.claude/CLAUDE.md', '.eas/agent', '.dsh'].map(name => path.join(os.homedir(), name))
const digestFile = file => { try { return fs.statSync(file).isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'directory' } catch { return 'absent' } }
const before = globalRules.map(digestFile)
const policy = '(version 1) (allow default) ' + globalRules.map(file => '(deny file-write* (subpath ' + JSON.stringify(file) + '))').join(' ')
// Verify the exact inherited OS policy without writing any bytes. Opening r+ either fails
// with EPERM/EACCES or is immediately closed and the test fails before app launch.
const probeTargets = globalRules.filter(file => { try { return fs.statSync(file).isFile() } catch { return false } })
const probeCode = 'const fs=require("node:fs");const result=process.argv.slice(1).map(file=>{try{const fd=fs.openSync(file,"r+");fs.closeSync(fd);return {file,denied:false}}catch(e){return {file,denied:["EPERM","EACCES"].includes(e.code),code:e.code}}});process.stdout.write(JSON.stringify(result))'
const globalWriteProtectionProbe = JSON.parse(execFileSync('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, '-e', probeCode, ...probeTargets], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }))
const globalWriteProtectionEnforced = globalWriteProtectionProbe.length > 0 && globalWriteProtectionProbe.every(item => item.denied)
if (!globalWriteProtectionEnforced) throw new Error('OS global-rule write protection could not be verified; app not launched')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let app, ws, evaluate, send
const report = { cli, requestedTool, globalWriteProtectionEnforced, globalWriteProtectionProbe, executable, executableSha256: digestFile(executable), profile, project, realModelCalls: true, simulatedTransport: false, phases: [], passed: false }
const bounded = async (fn, duration, description) => { const deadline = Date.now() + duration; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await wait(150) } throw new Error(description) }
async function launch() {
  try { fs.unlinkSync(path.join(profile, 'DevToolsActivePort')) } catch {}
  const env = { ...process.env, EAS_VERIFY: '1' }
  for (const key of Object.keys(env)) if (key.startsWith('EAS_TERM_') || key.startsWith('EAS_CAPABILITY_')) delete env[key]
  app = spawn('/usr/bin/sandbox-exec', ['-p', policy, executable, '--remote-debugging-port=0', '--no-sandbox', '--user-data-dir=' + profile], { cwd: project, env, stdio: ['ignore', 'ignore', 'ignore'] })
  const port = await bounded(() => {
    if (app.exitCode !== null) throw new Error('Package exited before debugger')
    try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { return false }
  }, 30000, 'No debugger endpoint')
  const page = await bounded(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && !p.url.includes('island')), 15000, 'No renderer page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', event => { const data = JSON.parse(event.data), call = pending.get(data.id); if (call) { pending.delete(data.id); clearTimeout(call.timer); data.error ? call.reject(new Error('CDP failed')) : call.resolve(data.result) } })
  send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })) })
  evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value }
  await bounded(() => evaluate('!!window.__store && !!window.api?.agentChat'), 30000, 'Verification renderer store/preload unavailable')
  await evaluate(`window.api.capabilities.setModule('workbench', true)`)
  report.bundle = await evaluate('window.api.capabilities.status()')
}
async function close() {
  if (ws?.readyState === WebSocket.OPEN) { try { await evaluate('window.__packageUnsubscribe?.(); if(window.__packageSession) window.api.agentChat.stop(window.__packageSession)') } catch {} }
  ws?.close(); ws = undefined
  if (app && app.exitCode === null && app.signalCode === null) {
    app.kill('SIGTERM')
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), wait(3000)])
    if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL')
  }
}
async function phase(name, file, resumeId) {
  // The decoy Frame is first and active. Correct placement must use the managed lease's leaf/node.
  await evaluate(`(() => { const s=window.__store.getState(); const pane={kind:'agent',cwd:${JSON.stringify(project)},cli:${JSON.stringify(cli)}};
    const frame=(id,leaf,node,x)=>({id,name:id,projectId:'verification-project',x,y:0,w:900,h:800,collapsed:false,nodes:[{id:node,leafId:leaf,x:30,y:40,w:700,h:650}]});
    window.__store.setState({viewMode:'canvas',projects:[{id:'verification-project',name:'CLI 验证',path:${JSON.stringify(project)}}],activeProjectId:'verification-project',tabs:[{id:'decoy-tab',title:'Decoy',cwd:${JSON.stringify(project)},activeLeafId:'decoy-leaf',root:{type:'leaf',id:'decoy-leaf',pane}}, {id:'target-tab',title:'Target',cwd:${JSON.stringify(project)},activeLeafId:'target-leaf',root:{type:'leaf',id:'target-leaf',pane}}],activeTabId:'decoy-tab',canvas:{...s.canvas,frames:[frame('decoy-frame','decoy-leaf','decoy-node',0),frame('target-frame','target-leaf','target-node',1000)]}});
    window.__packageEvents=[]; window.__packageUnsubscribe?.(); })()`)
  const message = `This is an authorized packaged MCP acceptance check. Use the Eas-Term ${requestedTool} MCP tool exactly once to open this existing local PNG: ${file}. Do not use bash, code, file editing, image generation, external services, or any other mutation. Discover the MCP tool if needed. Pass only path; do not specify a Frame. After the tool succeeds reply DONE. A text claim without the real MCP call does not pass.`
  const params = { cli, cwd: project, message, agentLeafId: 'target-leaf', agentNodeId: 'target-node', skipApprovalHook: true, ...(resumeId ? { resumeId } : {}), ...(option('--model') ? { model: option('--model') } : {}) }
  const started = await evaluate(`(async()=>{const result=await window.api.agentChat.start(${JSON.stringify(params)});if(result.ok){window.__packageSession=result.sessionId;window.__packageUnsubscribe=window.api.agentChat.onEvent(result.sessionId,event=>window.__packageEvents.push(event));}return result})()`)
  if (!started.ok) throw new Error('Native session start rejected: ' + started.error)
  const item = { name, file, sessionId: started.sessionId, requestedResumeId: resumeId ?? null }
  report.phases.push(item)
  await bounded(async () => {
    const events = await evaluate('window.__packageEvents')
    // Never automatically approve arbitrary native commands even if a model ignores the narrow prompt.
    if (events.some(e => e.k === 'approval.request')) throw new Error('Native approval requested; inspect the user-visible request')
    if (events.some(e => e.k === 'error' && e.fatal)) throw new Error('Fatal native CLI event')
    return events.some(e => e.k === 'turn.done')
  }, timeout, 'Native model turn did not finish')
  const events = await evaluate('window.__packageEvents')
  item.resumeId = events.filter(e => e.k === 'session.ready').at(-1)?.sessionId
  const executions = events.filter(e => e.k === 'exec.start' || e.k === 'exec.done')
  // Retain only tool receipts, never model text, environment, auth files or stderr.
  item.nativeToolProof = cli === 'omp' ? ompCanvasProof(profile, file, requestedTool) : []
  const canvasIds = new Set([...executions.filter(e => JSON.stringify(e).includes(requestedTool)).map(e => e.execId), ...item.nativeToolProof.map(e => e.execId)])
  item.diagnostics = { eventCounts: events.reduce((counts, e) => { counts[e.k] = (counts[e.k] ?? 0) + 1; return counts }, {}), executionIds: executions.map(e => ({ k:e.k, execId:e.execId, ok:e.ok, tool:e.tool })), errors: events.filter(e => e.k === 'error').map(e => ({ fatal:e.fatal, message:String(e.message ?? '').replace(/(?:sk-|Bearer )[A-Za-z0-9._-]+/g,'[REDACTED]').slice(0,500) })) }
  item.executions = executions.filter(e => canvasIds.has(e.execId)).map(e => ({ k:e.k, execId:e.execId, tool:e.tool, label:e.label, detail:e.detail, ok:e.ok, output:e.output }))
  const startIds = new Set(item.executions.filter(e => e.k === 'exec.start').map(e => e.execId))
  if (!item.executions.some(e => e.k === 'exec.done' && e.ok && startIds.has(e.execId))) throw new Error('No paired real successful ' + requestedTool + ' execution events')
  item.canvas = await evaluate(`(() => { const s=window.__store.getState(); const leaves=n=>n.type==='leaf'?[n]:n.children.flatMap(leaves); const all=s.tabs.flatMap(t=>leaves(t.root)); return s.canvas.frames.map(f=>({id:f.id,nodes:f.nodes.map(n=>({id:n.id,leafId:n.leafId,pane:n.pane??all.find(l=>l.id===n.leafId)?.pane})).filter(n=>n.pane?.kind==='image').map(n=>({id:n.id,filePath:n.pane.filePath}))})) })()`)
  const matches = item.canvas.flatMap(f => f.nodes.filter(n => n.filePath === file).map(n => ({ frameId:f.id,nodeId:n.id })))
  if (matches.length !== 1 || matches[0].frameId !== 'target-frame') throw new Error('PNG did not appear exactly once in the lease-bound target Frame')
  if (!item.resumeId) throw new Error('Native CLI supplied no resumable identity')
  if (resumeId && item.resumeId !== resumeId) throw new Error('CLI resumed a different identity')
  // Placement was checked while the decoy was active. Only now center the actual
  // destination for a useful screenshot, then verify the real renderer decoded its PNG.
  await evaluate(`(() => { const s=window.__store.getState(), f=s.canvas.frames.find(f=>f.id==='target-frame'); const scale=Math.min(.8,(innerWidth-100)/f.w,(innerHeight-150)/f.h); s.setMaximizedNode(null); s.setViewport({x:(innerWidth-f.w*scale)/2-f.x*scale,y:70-f.y*scale,scale}) })()`)
  item.imageDecoded = await bounded(() => evaluate(`(() => { const node=document.querySelector('.cfile-node[data-node-id="'+${JSON.stringify(matches[0].nodeId)}+'"]'); const img=node?.querySelector('img'); return img?.complete && img.naturalWidth>0 && img.naturalHeight>0 ? {nodeId:${JSON.stringify(matches[0].nodeId)},naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight}:null })()`),15000,'Placed PNG did not decode in the actual target image pane')
  await wait(300)
  item.passed = true
  const shot = await send('Page.captureScreenshot', { format:'png' })
  fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(shot.data,'base64'))
  await evaluate('window.__packageUnsubscribe?.(); window.api.agentChat.stop(window.__packageSession); window.__packageSession=null')
  await wait(500)
  return item.resumeId
}
try {
  await launch()
  const first = await phase('new', files[0])
  const resumed = await phase('resume', files[1], first)
  if (args.includes('--restart')) { await close(); await launch(); await phase('app-restart-resume', files[2], resumed) }
  report.passed = true
} catch (error) {
  if (ws?.readyState === WebSocket.OPEN) try {
    report.failureDiagnostics = await evaluate(`(() => { const events=window.__packageEvents??[]; return { eventCounts:events.reduce((counts,e)=>{counts[e.k]=(counts[e.k]??0)+1;return counts},{}), executions:events.filter(e=>e.k==='exec.start'||e.k==='exec.done').map(e=>({k:e.k,execId:e.execId,tool:e.tool,ok:e.ok})), fatalErrors:events.filter(e=>e.k==='error').map(e=>({fatal:e.fatal})), bundle:null } })()`)
    report.failureDiagnostics.bundle = await evaluate('window.api.capabilities.status()')
  } catch { /* Preserve the original failure if renderer has exited. */ }
  report.error = String(error.message).slice(0, 2000)
  process.exitCode = 1
} finally {
  await close()
  report.globalRuleFileHashes = globalRules.map((file,i) => ({ file, before:before[i], after:digestFile(file) }))
  report.globalRuleFilesUnchanged = report.globalRuleFileHashes.every(file => file.before === file.after)
  report.globalConcurrencyDetected = !report.globalRuleFilesUnchanged
  if (!report.globalRuleFilesUnchanged) report.globalRuleObservation = 'Protected global file hashes changed during the run. The same OS sandbox denied write-open for this process tree; writer attribution is unknown. Do not claim these global files were unchanged.'
  if (!report.globalRuleFilesUnchanged && !report.globalWriteProtectionEnforced) { report.passed = false; process.exitCode = 1 }
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ passed:report.passed, cli, output, profile, phases:report.phases.length }))
}
