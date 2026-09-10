import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAcpLive } from './transport.ts'
import type { ChatEvent } from '../../../shared/agentChat.ts'

// Actual bundled OMP + production transport, with an isolated zero-cost localhost model.
test('real OMP redirect survives old cancellation deadline and completes new direction', {
  skip: !process.env.EAS_VERIFY_REAL_OMP, timeout: 45_000
}, async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'eas-omp-redirect-'))
  const agent = path.join(profile, 'agent'); mkdirSync(agent)
  let requests = 0, killed = 0, child: ChildProcessWithoutNullStreams | undefined
  const events: ChatEvent[] = [], logs: string[] = []
  const model = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      const number = ++requests
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (content: string, finish: string | null) => res.write('data: ' + JSON.stringify({
        id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
        choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finish }]
      }) + '\n\n')
      chunk('', null)
      if (number === 1) return // cancellation must abort the old request
      const timer = setTimeout(() => { chunk('REDIRECT_SURVIVED', 'stop'); res.end('data: [DONE]\n\n') }, 4500)
      res.on('close', () => clearTimeout(timer))
    })
  })
  await new Promise<void>(r => model.listen(0, '127.0.0.1', r))
  const port = (model.address() as { port: number }).port
  writeFileSync(path.join(agent, 'models.yml'), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
    models: [{ id: 'fixture', name: 'Fixture', api: 'openai-completions', reasoning: false,
      input: ['text'], contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]
  } } }))
  writeFileSync(path.join(agent, 'config.yml'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', tools: { approvalMode: 'yolo' } }))
  const live = createAcpLive({
    clientVersion: 'test', now: Date.now, mcpServers: () => [], emit: e => events.push(e), log: s => logs.push(s),
    open() {
      child = spawn(path.resolve(process.env.EAS_VERIFY_REAL_OMP!), ['acp', '--tools=read'], { cwd: profile,
        env: { HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile, TEMP: profile, TMP: profile,
          PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? {SystemRoot:process.env.SystemRoot}:{}),
          ...(process.env.WINDIR ? {WINDIR:process.env.WINDIR}:{}), PI_CODING_AGENT_DIR: agent, PI_CONFIG_DIR: '.pi', OMP_SKIP_SETUP: '1' }, stdio: 'pipe' })
      const p = child, lines = createInterface({ input: p.stdout })
      return { ok: true, proc: { write: s => { p.stdin.write(s) }, onLine: cb => { lines.on('line', cb) },
        onStderr: cb => { p.stderr.on('data', b => cb(String(b))) }, onExit: cb => { p.on('exit', cb) },
        kill: () => { killed++; p.kill() } } }
    }
  }, profile, {idPrefix:'redirect:'})
  const until = async (fn:()=>boolean) => { const start=Date.now();while(!fn()){if(Date.now()-start>25000)throw Error('OMP wait timed out: '+logs.join('\n'));await new Promise(r=>setTimeout(r,25))} }
  try {
    live.deliver('Old direction'); await until(()=>requests===1)
    assert.equal(live.interrupt(),true); await until(()=>live.phase()==='ready')
    live.deliver('New direction'); await until(()=>requests===2)
    await until(()=>live.phase()==='ready')
    assert.equal(killed,0,logs.join('\n')); assert.equal(child?.exitCode,null); assert.equal(child?.signalCode,null)
    assert.equal(requests,2); assert.ok(JSON.stringify(events).includes('REDIRECT_SURVIVED'))
    assert.ok(!logs.some(s=>s.includes('改为结束进程')))
  } finally {
    live.close()
    if(child && child.exitCode===null && child.signalCode===null) {
      const p=child; const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill()
      await Promise.race([exited,new Promise<void>(r=>setTimeout(()=>{p.kill('SIGKILL');r()},1500))])
    }
    model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()))
    await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100})
  }
})
