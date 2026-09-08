import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL('../../'+p, import.meta.url), 'utf8')
test('diagnostic build has independent identity and never checks production updates', () => {
  const pkg = JSON.parse(read('../package.json'))
  assert.equal(pkg.name, 'eas-term-diagnostic')
  assert.equal(pkg.build.appId, 'com.biily.easterm.diagnostic')
  assert.match(read('main/updater.ts'), /if \(isDiagnosticBuild\(\)\) return null/)
})
test('hooks cover chat request, CLI spawn, OMP and PTY without output collection', () => {
  for (const [p, markers] of [
    ['main/agentChat/session.ts', ['chat-start', 'chat-send', 'cli-spawn', 'cli-started', 'cli-error', 'cli-exit']],
    ['main/agentChat/omp/launch.ts', ['cli-spawn', 'cli-started', 'cli-error', 'cli-exit']],
    ['main/pty.ts', ['pty-create', 'pty-started', 'pty-error', 'pty-exit']]
  ]) for (const marker of markers) assert.ok(read(p).includes(`recordDiagnostic('${marker}'`), p + marker)
  assert.match(read('main/index.ts'), /initializeDiagnostics/)
})
