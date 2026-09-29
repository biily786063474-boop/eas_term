// 源码断言：pluginHost 顶层 import electron、PluginPanel 是 React 组件，都没法直接跑，
// 照 src/main/pluginPopupSecurity.test.mjs 的做法钉住关键接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('./PluginPanel.tsx', import.meta.url), 'utf8')

test('PluginPanel 就地处理 ui/message：挂 chip，不转主进程、不写终端', () => {
  const start = src.indexOf("case 'ui/message':")
  assert.ok(start > 0, '缺 ui/message 分支')
  // 分支止于下一个 case 或 default（ui/message 后面紧跟的是会转 panelRpc 的 default，不能圈进来）
  const ends = [src.indexOf('case ', start + 20), src.indexOf('default:', start)].filter((i) => i > 0)
  const body = src.slice(start, Math.min(...ends))
  assert.match(body, /uiMessageChip\(r\.params/)
  assert.match(body, /useStore\.getState\(\)\.composerAddChip/)
  assert.match(body, /NO_COMPOSER_ERROR/)
  assert.doesNotMatch(body, /panelRpc|pty|\.write\(/)
})

test('ui/message 先过闸门（本地插件 + 焦点在本面板）再挂 chip，拒绝时回错误', () => {
  const start = src.indexOf("case 'ui/message':")
  const ends = [src.indexOf('case ', start + 20), src.indexOf('default:', start)].filter((i) => i > 0)
  const body = src.slice(start, Math.min(...ends))
  const focus = body.indexOf('document.activeElement === f')
  const list = body.indexOf('window.api.plugins.list()')
  const gate = body.indexOf('uiMessageAllowed(')
  const add = body.indexOf('add(res.chip)')
  assert.ok(focus > 0, '缺焦点判据 document.activeElement === f')
  assert.ok(list > 0, '缺本地/远程判据（plugins.list 里的 remote）')
  assert.match(body, /!!plugin\.remote/)
  assert.ok(gate > 0 && add > 0, '缺闸门或挂 chip')
  assert.ok(focus < list, '焦点要在 await 之前取，量的是请求到达那一刻')
  assert.ok(gate < body.indexOf('useStore.getState().composerAddChip') && gate < add, '闸门必须在 composerAddChip 之前')
  assert.match(body, /if \(!gate\.ok\) \{ post\(errorResponse\(r\.id, [^)]+, gate\.error\)\); return \}/)
})
