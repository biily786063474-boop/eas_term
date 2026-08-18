import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planInstall, planUninstall, wrapperCommand, shq, STATUSLINE_TAG } from './statuslineInstall.ts'

// 本机真实配置：claude-hud 那条动态找版本目录的命令，带一堆嵌套引号
// 用单引号字符串，别用反引号 —— 样本里的 ${plugin_dir} 会被 JS 当成模板变量
const HUD =
  'bash -c \'plugin_dir=$(ls -d "$HOME/.claude"/plugins/cache/claude-hud/*/ | tail -1); ' +
  'exec "/opt/homebrew/bin/node" "${plugin_dir}dist/index.js"\''
const W = wrapperCommand('/opt/homebrew/bin/node', '/A/eas-statusline.mjs', HUD)

test('原命令经 env 传，不拼进命令行 —— 拼字符串遇到嵌套引号必坏', () => {
  assert.ok(W.startsWith('EAS_STATUSLINE_WRAPPED='))
  assert.ok(W.includes("'/A/eas-statusline.mjs'"))
})

test('单引号转义：命令里的单引号不会把命令拆散', () => {
  const q = shq("a'b")
  assert.equal(q, `'a'\\''b'`)
})

// 直接改写 command 等于废掉用户的状态栏
test('安装是包装，原命令原样存进 _easWrapped', () => {
  const r = planInstall({ type: 'command', command: HUD }, W, HUD)
  assert.ok(r.next)
  assert.equal(r.next.command, W)
  assert.equal(r.next._easWrapped, HUD, '原命令必须原样保留')
  assert.equal(r.next._easTerm, STATUSLINE_TAG)
})

test('卸载把原命令原样放回', () => {
  const installed = planInstall({ type: 'command', command: HUD }, W, HUD).next
  const r = planUninstall(installed)
  assert.equal(r.changed, true)
  assert.equal(r.next?.command, HUD, '放回的必须是原文，不是重新拼的')
  assert.equal(r.next?._easTerm, undefined)
  assert.equal(r.next?._easWrapped, undefined)
})

// 包成套娃的话，每刷新一次就多跑一层
test('重复安装是幂等的，不会包套娃', () => {
  const once = planInstall({ type: 'command', command: HUD }, W, HUD).next
  const again = planInstall(once, W, HUD)
  assert.equal(again.next, null, '已是最新就不该再写')
})

test('app 升级换了脚本路径：更新包装层，但 _easWrapped 不动', () => {
  const once = planInstall({ type: 'command', command: HUD }, W, HUD).next
  const W2 = wrapperCommand('/opt/homebrew/bin/node', '/B/eas-statusline.mjs', HUD)
  const r = planInstall(once, W2, '这是我们自己那层，绝不能被当成原命令存进去')
  assert.ok(r.next)
  assert.equal(r.next.command, W2)
  assert.equal(r.next._easWrapped, HUD, '原命令必须还是最初那条')
})

test('用户原来没配 statusline：卸载时整个字段删掉，不留一个空命令', () => {
  const installed = planInstall(undefined, W, '').next
  assert.equal(installed?._easWrapped, '')
  assert.equal(planUninstall(installed).next, undefined)
})

// 不是我们装的就一个字不碰
test('用户自己换了 statusline：卸载不动它', () => {
  const mine = { type: 'command', command: '我自己的命令' }
  const r = planUninstall(mine)
  assert.equal(r.changed, false)
  assert.deepEqual(r.next, mine)
})

test('用户配置里的其他字段原样保留', () => {
  const r = planInstall({ type: 'command', command: HUD, padding: 1 } as never, W, HUD)
  assert.equal((r.next as Record<string, unknown>).padding, 1)
})
