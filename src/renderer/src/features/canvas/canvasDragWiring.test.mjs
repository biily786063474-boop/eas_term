// 2026-09-29：插件 iframe 始终接收指针后，所有画布拖拽都必须走 resizeDrag.ts 的共用收尾
//（body.canvas-dragging 让 iframe/webview 不接鼠标 + mouseup/blur/Escape/buttons===0/卸载收尾）。
// 真机回归：框选划进插件面板就停、松手后选框仍跟着鼠标。这里钉住每个手势都接上了。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const files = {
  stage: read('./CanvasStage.tsx'),
  component: read('./CanvasComponentNode.tsx'),
  file: read('./CanvasFileNode.tsx'),
  free: read('./CanvasFreeFileNode.tsx'),
  shapes: read('./CanvasShapeLayer.tsx'),
  todo: read('./CanvasTodoBoard.tsx'),
  pane: read('../workspace/PaneView.tsx')
}
const css = read('./canvas.css')
/** 取出 `const name = (...) => { ... }` / useCallback 体里从名字开始的一段 */
const body = (src, name, len = 2600) => {
  const i = src.indexOf(name)
  assert.ok(i >= 0, name + ' missing')
  return src.slice(i, i + len)
}

test('no canvas gesture hand-wires document mousemove/mouseup any more', () => {
  for (const [k, src] of Object.entries(files)) {
    assert.doesNotMatch(src, /document\.addEventListener\('mouseup'/, k)
    assert.doesNotMatch(src, /document\.addEventListener\('mousemove'/, k)
  }
})

test('marquee, pan, shape draw/drag/resize and frame drag in CanvasStage use the shared drag', () => {
  assert.match(files.stage, /const beginDrag = useCanvasDrag\(\)/)
  for (const name of ['const beginPan = useCallback', 'const startBoxSelect =', 'const startShapeDrag =', 'const startShapeResize =', 'const startFrameDrag =']) {
    assert.match(body(files.stage, name), /beginDrag\(/, name)
  }
  // 画图形那一支在 onViewportDown 里
  assert.match(body(files.stage, 'const onViewportDown =', 4000), /beginDrag\(/)
  // 原来用 attachBlurGuard 过滤灵动岛抖动的，继续用
  assert.match(files.stage, /blurGuard: attachBlurGuard/)
})

test('node move-drags and other canvas layers use the shared drag', () => {
  for (const k of ['component', 'file', 'free']) {
    assert.match(files[k], /useCanvasDrag\(\)/, k)
    assert.match(body(files[k], 'const startDrag ='), /beginDrag\(/, k)
  }
  assert.match(body(files.pane, 'const onCanvasHeadDown ='), /beginDrag\(/)
  assert.match(body(files.shapes, 'const startShapeDrag ='), /beginDrag\(/)
  assert.match(body(files.shapes, 'const startShapeResize ='), /beginDrag\(/)
  assert.match(body(files.todo, 'const startBoardDrag ='), /beginDrag\(/)
  assert.match(body(files.todo, 'const startItemDrag ='), /beginDrag\(/)
})

test('canvas-dragging releases iframe/webview/plugin frame pointer like canvas-resizing', () => {
  assert.match(css, /body\.canvas-dragging iframe,\s*body\.canvas-dragging webview,\s*body\.canvas-dragging \.plg-frame\s*\{[^}]*pointer-events:\s*none/)
})
