// 已打开的插件面板要跟着主题切换（2026-10-02：切到亮色后所有面板还停在深色）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const src = fs.readFileSync(new URL('./PluginPanel.tsx', import.meta.url), 'utf8')
test('主题切换时向已开面板发 host-context-changed（盯 <html data-theme>）', () => {
  const i = src.indexOf("attributeFilter: ['data-theme']")
  assert.ok(i > 0, '要盯 data-theme 属性')
  const block = src.slice(src.lastIndexOf('useEffect(', i), src.indexOf('}, [state])', i))
  assert.match(block, /new MutationObserver/)
  assert.match(block, /ui\/notifications\/host-context-changed/)
  assert.match(block, /theme: now/)
  assert.match(block, /mo\.disconnect\(\)/)
})
