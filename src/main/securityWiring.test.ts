import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 结构守卫（2026-09-14 评审 S1–S4）：改动一旦被"顺手"改回去，这里当场红。
const src = (f: string) => readFileSync(new URL('./' + f, import.meta.url), 'utf8')
test('S1：安装命令必须经 resolveInstallCommand 查表，不能把参数直接 spawn', () => {
  const s = src('cliAuth/install.ts')
  assert.ok(s.includes('resolveInstallCommand('), '没有查表')
  assert.ok(!/spawn\('\/bin\/sh', \['-c', cmd\]/.test(s.split('resolveInstallCommand(')[0]), '查表之前不得 spawn')
})
test('S2：主进程挂了 will-attach-webview 并调用加固函数', () => {
  const s = src('index.ts')
  assert.ok(s.includes("'will-attach-webview'") && s.includes('hardenWebviewPreferences('))
})
test('S3：wiki:init / wiki:setPath 走根路径门', () => {
  const s = src('wiki/index.ts')
  for (const ch of ["'wiki:init'", "'wiki:setPath'"]) {
    const i = s.indexOf(ch); assert.ok(i >= 0)
    assert.ok(s.slice(i, i + 700).includes('rootGate.allowed('), ch + ' 没有过门')
  }
})
test('S4：敏感文件里不再有裸的 ipcMain.handle / ipcMain.on', () => {
  for (const f of ['secrets.ts', 'pty.ts', 'fs.ts', 'git.ts', 'cliAuth/index.ts', 'cliAuth/install.ts', 'agentChat/session.ts', 'wiki/index.ts']) {
    const s = src(f)
    assert.equal((s.match(/ipcMain\.(handle|on)\(/g) ?? []).length, 0, f + ' 还有裸的 ipcMain 注册')
    assert.ok(/guarded(Handle|On)\(/.test(s), f + ' 没有用守卫版注册')
  }
})
