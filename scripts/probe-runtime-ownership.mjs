// P0 ownership probe. No app state, credentials, production PID or external network.
// Children self-expire after 3s; only the ChildProcess created here is signalled.
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
const wait = ms => new Promise(r => setTimeout(r, ms))
if (process.argv[2] === '--parent') {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(0),3000)'], {
    detached: process.argv[3] === 'detached', stdio: 'ignore', env: {}
  })
  child.once('spawn', () => process.send?.({ pid: child.pid }))
  // Safety expiry even if controlling probe crashes before signalling us.
  setTimeout(() => process.exit(0), 4500)
} else {
  const results = []
  for (const mode of ['ordinary', 'detached']) {
    const parent = spawn(process.execPath, [import.meta.filename, '--parent', mode], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: {}
    })
    try {
      const msg = await Promise.race([
        once(parent, 'message').then(([msg]) => msg),
        wait(2000).then(() => { throw new Error('child startup timeout') })
      ])
      assert.ok(Number.isInteger(msg.pid) && msg.pid > 0)
      const exited = once(parent, 'exit')
      parent.kill('SIGTERM')
      await exited
      await wait(100)
      // Read-only liveness check of a PID reported by our own test parent.
      let alive = true
      try { process.kill(msg.pid, 0) } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e }
      const inspect = () => {
        try {
          return execFileSync('/bin/ps', ['-p', String(msg.pid), '-o', 'pid=,ppid=,stat=,lstart='],
            { encoding: 'utf8', timeout: 1000 }).trim() || null
        } catch (e) { if (e.status === 1) return null; throw e }
      }
      const afterParentExit = inspect()
      const result = { mode, parentExited: true, childAliveAfterParentExit: alive,
        afterParentExit, afterSelfExpiry: null }
      results.push(result)
      await wait(3400) // descendants self-expire; never signal a recycled PID
      result.afterSelfExpiry = inspect()
      assert.equal(result.afterSelfExpiry, null, 'test descendant did not disappear after self-expiry')
    } finally {
      if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGTERM')
    }
  }
  console.log(JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform,
    scope: 'isolated Node subprocesses; NOT proof of production launcher cleanup', results }, null, 2))
}
