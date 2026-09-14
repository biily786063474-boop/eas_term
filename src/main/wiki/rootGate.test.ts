import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWikiRootGate } from './rootGate.ts'

// S3：wiki:init / wiki:setPath 只接受主进程自己对话框（或默认建议）返回过的路径，
// 或 guardDir 允许的目录；渲染层随手传一个绝对路径不能再让主进程去那里建目录写文件。
test('对话框返回过的路径放行；guardDir 允许的放行；其余拒绝', () => {
  const gate = createWikiRootGate({ guardDir: p => ({ ok: p.startsWith('/allowed/') }) })
  assert.equal(gate.allowed('/tmp/anything'), false)
  gate.remember('/Users/me/Documents/eas-wiki')
  assert.equal(gate.allowed('/Users/me/Documents/eas-wiki'), true)
  assert.equal(gate.allowed('/Users/me/Documents/eas-wiki/../other'), false, '归一化后不同就不算')
  assert.equal(gate.allowed('/allowed/proj/wiki'), true)
  gate.remember(null); assert.equal(gate.allowed(''), false)
})
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// 审查发现：记住时目录还不存在（存的是 resolve 结果），建好后再比时走 realpath，祖先是符号链接就对不上。
// 归一化要用「最深的已存在祖先的 realpath + 剩余部分」。
test('记住时不存在、建好后再比：祖先是符号链接也能对上', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-'))
  const real = path.join(base, 'real'), link = path.join(base, 'link')
  fs.mkdirSync(real); fs.symlinkSync(real, link)
  const gate = createWikiRootGate({ guardDir: () => ({ ok: false }) })
  const wanted = path.join(link, 'wiki-new')
  gate.remember(wanted)                       // 此时 wiki-new 还不存在
  fs.mkdirSync(wanted)                        // 建好了
  assert.equal(gate.allowed(wanted), true)
  assert.equal(gate.allowed(path.join(real, 'wiki-new')), true, '真实路径写法也算同一处')
  fs.rmSync(base, { recursive: true, force: true })
})
