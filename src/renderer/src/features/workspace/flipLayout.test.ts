import test from 'node:test'
import assert from 'node:assert/strict'
import { maximizeKeyframes } from './flip.ts'
const large={left:0,top:0,w:1200,h:800},small={left:120,top:90,w:480,h:340}
test('shrink animates transform while keeping content layout constant until completion',()=>{
 const frames=maximizeKeyframes(large,small)
 assert.equal(frames[0].width,'1200px');assert.equal(frames[1].width,'1200px')
 assert.equal(frames[0].height,frames[1].height)
 assert.equal(frames[0].transform,'translate(-120px, -90px)')
 assert.equal(frames[1].transform,'scale(0.4, 0.425)')
})
test('grow keeps existing FLIP geometry and does not override React layout',()=>{
 const frames=maximizeKeyframes(small,large)
 assert.equal(frames[0].width,undefined);assert.equal(frames[1].transform,'none')
 assert.equal(frames[0].transformOrigin,'0 0')
})
test('PaneView visual targets account for canvas scale while max layout stays 1:1',()=>{
 for(const scale of [.5,1.5]){
  const frames=maximizeKeyframes(large,{...small,w:small.w*scale,h:small.h*scale})
  assert.equal(frames[0].width,'1200px')
  assert.equal(frames[1].transform,`scale(${480*scale/1200}, ${340*scale/800})`)
 }
})
