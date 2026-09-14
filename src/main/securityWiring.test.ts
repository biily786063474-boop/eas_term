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
test('S4：src/main 下除 ipcGuard.ts 外不再有裸的 ipcMain.handle / ipcMain.on（守卫是默认，不是清单）', async () => {
  const fs = await import('node:fs'), path = await import('node:path'), { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('./', import.meta.url))
  const bad: string[] = []
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) { if (name !== '__fixtures__') walk(full); continue }
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'ipcGuard.ts') continue
      if (/ipcMain\.(handle|on)\(/.test(fs.readFileSync(full, 'utf8'))) bad.push(path.relative(root, full))
    }
  }
  walk(root)
  assert.deepEqual(bad, [], '这些文件仍在裸用 ipcMain，改用 guardedHandle / guardedOn')
})
