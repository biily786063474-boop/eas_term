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
