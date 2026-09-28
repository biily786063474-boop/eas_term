import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planDockPlacement } from './planDockPlacement.ts'
const bounds = { left: 0, top: 0, right: 1200, bottom: 800 }
const pane = { left: 100, top: 80, right: 700, bottom: 650 }
test('task list is anchored to the pane upper right', () => {
  const p = planDockPlacement(pane, bounds, false, false)!
  assert.deepEqual([p.side, p.left, p.top, p.width, p.compact], ['right',710,134,260,false])
})
test('pan near either viewport edge never flips or clamps the anchor', () => {
  for (const [x,y] of [[400,0],[-300,-150],[0,620],[450,20]]) {
    const moved = {left:pane.left+x,right:pane.right+x,top:pane.top+y,bottom:pane.bottom+y}
    const p = planDockPlacement(moved,bounds,false,true)!
    assert.equal(p.side,'right'); assert.equal(p.left,moved.right+10); assert.equal(p.top,moved.top+54)
  }
})
test('collapse and expand do not move the canvas anchor or depend on viewport space', () => {
  const tight={left:0,top:0,right:760,bottom:500}
  const p={left:24,top:10,right:736,bottom:490}
  const open=planDockPlacement(p,tight,false,false)!
  const closed=planDockPlacement(p,tight,true,false)!
  assert.equal(open.compact,false);assert.equal(closed.compact,true)
  assert.deepEqual([open.left,open.top],[closed.left,closed.top]);assert.equal(open.width,260);assert.equal(closed.width,32)
})
test('zoom keeps module-local anchor offsets and size', () => {
  for (const scale of [.5,1,1.5]) {
    const p=planDockPlacement(pane,bounds,false,false,scale)!
    assert.equal((p.left-pane.right)/scale,10);assert.equal((p.top-pane.top)/scale,54);assert.equal(p.scale,scale)
  }
})
test('maximized pane keeps an accessible upper-right inset, never switches sides', () => {
  for (const collapsed of [true,false]) {
    const p=planDockPlacement(bounds,bounds,collapsed,true,1,true)!
    assert.equal(p.side,'right');assert.equal(p.left+p.width,bounds.right-8);assert.equal(p.top,54)
  }
})
test('fully offscreen pane does not leave a detached dock', () => {
  assert.equal(planDockPlacement({left:-900,top:30,right:-100,bottom:500},bounds,false,false),null)
})

// 2026-09-28 用户截图：停靠卡片压在「任务进行中」和额度条上面。它们在根层直接比 z-index，
// 这里从真实 CSS 读出那几层的数值，改了任一边都会在这里对不上。
test('停靠卡片低于画布界面层、高于画布内容；最大化时高于最大化模块', async () => {
  const fs = await import('node:fs')
  const { PLAN_DOCK_Z, PLAN_DOCK_Z_MAXIMIZED, planDockZ } = await import('./planDockPlacement.ts')
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const zOf = (css: string, selector: string): number => {
    const at = css.search(new RegExp('(^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,{]'))
    assert.ok(at >= 0, '找不到 ' + selector)
    const m = css.slice(at, css.indexOf('}', at)).match(/z-index:\s*(\d+)/)
    assert.ok(m, selector + ' 没有 z-index')
    return Number(m[1])
  }
  const canvas = read('../canvas/canvas.css'), quota = read('../quota/quotaBar.css')
  const chrome = { 任务监视器: zOf(canvas, '.crm-mini'), 画布工具条: zOf(canvas, '.ctoolbar-mini'), 额度条: zOf(quota, '.qb-float') }
  for (const [name, z] of Object.entries(chrome)) assert.ok(PLAN_DOCK_Z < z, `停靠卡片 ${PLAN_DOCK_Z} 应低于${name} ${z}`)
  assert.ok(PLAN_DOCK_Z > 15, '要高于画布内容层（面板 auto、框架内浮层 ≤15）')
  const maxNode = Number(read('../canvas/CanvasFileNode.tsx').match(/zIndex:\s*(\d+)/)![1])
  assert.ok(PLAN_DOCK_Z_MAXIMIZED > maxNode, '最大化时要压过最大化模块 ' + maxNode)
  assert.equal(planDockZ(false), PLAN_DOCK_Z)
  assert.equal(planDockZ(true), PLAN_DOCK_Z_MAXIMIZED)
})
