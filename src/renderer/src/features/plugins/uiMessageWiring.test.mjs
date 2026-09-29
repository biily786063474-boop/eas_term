// 源码断言：pluginHost 顶层 import electron、PluginPanel 是 React 组件，都没法直接跑，
// 照 src/main/pluginPopupSecurity.test.mjs 的做法钉住关键接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('./PluginPanel.tsx', import.meta.url), 'utf8')

function branch() {
  const start = src.indexOf("case 'ui/message':")
  assert.ok(start > 0, '缺 ui/message 分支')
  // 分支止于下一个 case 或 default（ui/message 后面紧跟的是会转 panelRpc 的 default，不能圈进来）
  const ends = [src.indexOf('case ', start + 20), src.indexOf('default:', start)].filter((i) => i > 0)
  return src.slice(start, Math.min(...ends))
}

test('ui/message 按面板所在 Frame 找目标：AI 对话走 chipTargets，不再用全局 composerAddChip、不转主进程', () => {
  const body = branch()
  assert.match(body, /uiMessageChip\(r\.params/)
  assert.match(body, /frameInjectTargets\(/)
  assert.match(body, /collectLeaves\(/)
  assert.match(body, /chipTargets\[/)
  assert.match(body, /NO_TARGET_ERROR/)
  assert.match(body, /AGENT_NOT_READY_ERROR/)
  assert.doesNotMatch(body, /composerAddChip/)
  assert.doesNotMatch(body, /panelRpc/)
})

test('终端：先确认 pty 还活着，bracketed paste 写全文，绝不追加回车', () => {
  const body = branch()
  assert.match(body, /window\.api\.pty\.write\(/)
  assert.ok(body.includes('\\x1b[200~') && body.includes('\\x1b[201~'), '终端写入必须用 bracketed paste 包住')
  assert.doesNotMatch(body, /'\\r'|\\r|\\n'/, '分支里不许出现回车 / 换行字面量')
  assert.match(body, /TERMINAL_EXITED_ERROR/)
  const alive = body.indexOf("l.pane.kind === 'terminal' && l.pane.ptyId ===")
  assert.ok(alive > 0 && alive < body.indexOf('window.api.pty.write('), '写之前要确认 ptyId 仍在某个面板里')
})

test('多个目标弹选择菜单；已有菜单在开时直接拒；回显目标 kind + name', () => {
  const body = branch()
  assert.match(body, /PICK_BUSY_ERROR/)
  assert.match(body, /pickTarget\(/)
  assert.match(body, /PICK_CANCELLED_ERROR/)
  assert.match(body, /target: \{ kind: [^,]+, name: /)
  assert.match(src, /<CanvasContextMenu[\s\S]{0,400}注入到哪个？/)
  assert.match(src, /getBoundingClientRect\(\)/)
  // 卸载时对挂起的选择回「已取消」
  assert.match(src, /return \(\) => pickRef\.current\?\.resolve\(null\)/)
})

test('ui/message 先过闸门（本地插件 + 焦点在本面板）再找目标 / 注入，拒绝时回错误', () => {
  const body = branch()
  const focus = body.indexOf('document.activeElement === f')
  const list = body.indexOf('window.api.plugins.list()')
  const gate = body.indexOf('uiMessageAllowed(')
  assert.ok(focus > 0, '缺焦点判据 document.activeElement === f')
  assert.ok(list > 0, '缺本地/远程判据（plugins.list 里的 remote）')
  assert.match(body, /!!plugin\.remote/)
  assert.ok(focus < list, '焦点要在 await 之前取，量的是请求到达那一刻')
  assert.ok(gate > 0 && gate < body.indexOf('frameInjectTargets(') && gate < body.indexOf('chipTargets[') && gate < body.indexOf('window.api.pty.write('), '闸门必须在找目标与注入之前')
  assert.match(body, /if \(!gate\.ok\) \{ post\(errorResponse\(r\.id, [^)]+, gate\.error\)\); return \}/)
})
