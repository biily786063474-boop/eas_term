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
