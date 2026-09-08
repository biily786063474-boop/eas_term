import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveCapabilityCli } from '../../mcp/eas-pty-launcher.mjs'
const launcher = fileURLToPath(new URL('../../mcp/eas-pty-launcher.mjs', import.meta.url))
const parent = { instanceId: 'test', generation: 'g', id: 'parent', secret: 'PRIVATE-PARENT' }
async function fixture(t, childSource) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'PTY 空格-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'real bin'); fs.mkdirSync(bin)
  const executable = path.join(bin, 'codex')
  fs.writeFileSync(executable, '#!' + process.execPath + '\n' + childSource, { mode: 0o700 })
  const calls = []
  let next = 0
  let respond
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw); calls.push({ url: req.url, body })
    if (req.url === '/capability/launch') {
      if (respond) return respond(body, res)
      res.end(JSON.stringify({ ok: true, result: { leaseId: 'lease-' + (++next), command: executable, args: body.args, env: { MAIN_OVERRIDE: 'yes' } } }))
    } else res.end(JSON.stringify({ ok: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const env = { EAS_TERM_TOKEN: 'OLD-GLOBAL', EAS_PROJECT: '/stale', EAS_PTY_ID: 'old-pty', EAS_TEAM_ROLE: 'old-role', EAS_SECRET_TOKEN: 'KEEP-SECRET-BOUNDARY', PATH: bin, EAS_CAPABILITY_PARENT: JSON.stringify(parent), EAS_TERM_PORT: String(server.address().port), EAS_CAPABILITY_NODE_FALLBACK: '1', ELECTRON_RUN_AS_NODE: '1' }
  const start = (args = []) => spawn(process.execPath, [launcher, 'codex', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  return { root, bin, calls, start, env, server, setResponder: fn => { respond = fn } }
}
function completed(child) {
  return new Promise((resolve, reject) => {
    let out = '', err = ''
    child.stdout.on('data', c => { out += c }); child.stderr.on('data', c => { err += c })
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, out, err }))
  })
}
test('real launcher sends cwd/argv, strips parent authority and forwards exact exit code', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),parent:process.env.EAS_CAPABILITY_PARENT,fallback:process.env.EAS_CAPABILITY_NODE_FALLBACK,electron:process.env.ELECTRON_RUN_AS_NODE,override:process.env.MAIN_OVERRIDE,globalToken:process.env.EAS_TERM_TOKEN,project:process.env.EAS_PROJECT,pty:process.env.EAS_PTY_ID,teamRole:process.env.EAS_TEAM_ROLE,secretGrant:process.env.EAS_SECRET_TOKEN}));process.exitCode=23`)
  const args = ['', '中文 空格', '$(bad)', 'a"b', '%PATH%', 'line\nbreak']
  const result = await completed(f.start(args))
  assert.equal(result.code, 23)
  assert.deepEqual(JSON.parse(result.out), { args, cwd: f.root, override: 'yes', secretGrant: 'KEEP-SECRET-BOUNDARY' })
  assert.equal(f.calls[0].body.cwd, f.root)
  assert.deepEqual(f.calls[0].body.args, args)
  assert.equal(f.calls[0].body.binary, path.join(f.bin, 'codex'))
  assert.deepEqual(f.calls[1], { url: '/capability/launch/close', body: { parent, leaseId: 'lease-1' } })
  assert.ok(!result.err.includes(parent.secret))
})
test('two invocations close their own leases independently', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `process.exitCode=0`)
  const results = await Promise.all([completed(f.start(['a'])), completed(f.start(['b']))])
  assert.ok(results.every(r => r.code === 0))
  assert.deepEqual(f.calls.filter(c => c.url.endsWith('/close')).map(c => c.body.leaseId).sort(), ['lease-1', 'lease-2'])
})
test('signal reaches only the spawned CLI and still closes its lease', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `process.on('SIGTERM',()=>process.exit(42)); console.log('READY');setInterval(()=>{},1000)`)
  const child = f.start()
  const result = completed(child)
  await new Promise(resolve => child.stdout.once('data', resolve))
  child.kill('SIGTERM')
  assert.equal((await result).code, 42)
  assert.equal(f.calls.filter(c => c.url.endsWith('/close')).length, 1)
})
test('missing managed environment refuses before invoking any executable', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-noauth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const child = spawn(process.execPath, [launcher, 'codex'], { cwd: root, env: { PATH: '/bin' }, stdio: ['ignore','pipe','pipe'] })
  const result = await completed(child)
  assert.notEqual(result.code, 0)
  assert.match(result.err, /managed|受管/i)
})
test('PATH skips managed shim trees and symlinks to them; omp ignores PATH', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-resolve-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const managed = path.join(root,'capability-pty-bin','revision'), actual = path.join(root,'real')
  fs.mkdirSync(managed,{recursive:true});fs.mkdirSync(actual)
  fs.writeFileSync(path.join(managed,'codex'),'shim',{mode:0o700});fs.writeFileSync(path.join(actual,'codex'),'real',{mode:0o700})
  const aliasDir = path.join(root, 'symlink bin'); fs.mkdirSync(aliasDir)
  fs.symlinkSync(path.join(managed, 'codex'), path.join(aliasDir, 'codex'))
  assert.equal(resolveCapabilityCli('codex',{PATH:managed+path.delimiter+aliasDir+path.delimiter+actual}),fs.realpathSync(path.join(actual,'codex')))
  assert.throws(()=>resolveCapabilityCli('omp',{PATH:actual}),/OMP/)
})
test('Windows batch executables fail closed rather than shell-reparse user args', t => {
  // Test platform decision independently of the current host filesystem dialect.
  assert.throws(()=>resolveCapabilityCli('codex',{PATH:'C:\\bin',PATHEXT:'.CMD;.EXE'},'win32', p => p.endsWith('.CMD') ? p : undefined),/batch|\.cmd/i)
})

test('HTTP refusal never launches the CLI or retries', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `console.log('SHOULD_NOT_START')`)
  f.setResponder((_body, res) => { res.writeHead(403); res.end(JSON.stringify({ error: 'PRIVATE-PARENT' })) })
  const result = await completed(f.start())
  assert.equal(result.code, 1)
  assert.equal(result.out, '')
  assert.equal(f.calls.length, 1)
  assert.ok(!result.err.includes('PRIVATE-PARENT'))
})
test('SIGINT cancellation during launch wait closes returned lease without executing CLI', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `console.log('SHOULD_NOT_START')`)
  let received
  const incoming = new Promise(resolve => { received = resolve })
  let release
  f.setResponder((body, res) => {
    release = () => res.end(JSON.stringify({ ok: true, result: { leaseId: 'cancelled-lease', command: path.join(f.bin,'codex'), args: body.args, env: {} } }))
    received()
  })
  const child = f.start(), result = completed(child)
  await incoming
  child.kill('SIGINT')
  // Let the signal handler run before the delayed HTTP reply.
  await new Promise(resolve => setTimeout(resolve, 50))
  release()
  const done = await result
  assert.equal(done.code, 130)
  assert.equal(done.out, '')
  assert.deepEqual(f.calls.filter(c => c.url.endsWith('/close')).map(c => c.body.leaseId), ['cancelled-lease'])
})
test('real POSIX terminal Ctrl-C reaches native CLI once and leaves it interactive', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const f = await fixture(t, `let interrupts=0;process.on('SIGINT',()=>console.log('INT:'+ ++interrupts));process.stdin.on('data',d=>{if(d.toString().includes('ping')) console.log('PONG:'+interrupts);if(d.toString().includes('done')) process.exit(0)});console.log('READY')`)
  // openpty + controlling-terminal setup exercises real foreground-group SIGINT,
  // unlike child.kill('SIGINT'), which addresses only the wrapper process.
  const python = String.raw`
import os,pty,fcntl,termios,subprocess,sys,select,time,json,signal
master,slave=pty.openpty()
def setup():
 os.setsid()
 fcntl.ioctl(0,termios.TIOCSCTTY,0)
p=subprocess.Popen([sys.argv[1],sys.argv[2],'codex'],stdin=slave,stdout=slave,stderr=slave,preexec_fn=setup)
os.close(slave)
out=b''
def drain(seconds):
 global out
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if select.select([master],[],[],min(.05,max(0,end-time.monotonic())))[0]:
   try: data=os.read(master,65536)
   except OSError: return
   if not data: return
   out+=data
try:
 for _ in range(100):
  drain(.03)
  if b'READY' in out: break
 if b'READY' not in out: raise RuntimeError('native CLI not ready')
 for _ in range(3):
  os.write(master,b'\x03')
  drain(.2)
 drain(3.2)
 os.write(master,b'ping\n')
 drain(.3)
 os.write(master,b'done\n')
 drain(.3)
 p.wait(timeout=3)
 print(json.dumps({'output':out.decode(errors='replace'),'code':p.returncode}))
finally:
 if p.poll() is None:
  os.killpg(p.pid,signal.SIGTERM)
  p.wait(timeout=3)
 os.close(master)
`
  const child = spawn('/usr/bin/python3', ['-c', python, process.execPath, launcher], { cwd: f.root, env: { ...process.env, ...f.env }, stdio: ['ignore','pipe','pipe'] })
  const result = await completed(child)
  assert.equal(result.code, 0, result.err)
  const report = JSON.parse(result.out)
  assert.equal(report.code, 0)
  assert.deepEqual([...report.output.matchAll(/INT:(\d+)/g)].map(m=>Number(m[1])), [1,2,3])
  assert.match(report.output, /PONG:3/)
  assert.equal(f.calls.filter(c=>c.url.endsWith('/close')).length, 1)
})

test('non-TTY SIGINT is forwarded to the owned child and closes its lease', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `process.on('SIGINT',()=>process.exit(44));console.log('READY');setInterval(()=>{},1000)`)
  const child=f.start(), result=completed(child)
  await new Promise(resolve=>child.stdout.once('data',resolve))
  child.kill('SIGINT')
  assert.equal((await result).code,44)
  assert.equal(f.calls.filter(c=>c.url.endsWith('/close')).length,1)
})
