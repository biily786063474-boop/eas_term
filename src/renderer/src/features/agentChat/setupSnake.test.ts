import test from 'node:test'
import assert from 'node:assert/strict'
import { newGame, turn, tick, toggle } from './snakeEngine.ts'
test('单按钮开始暂停继续，不重置棋盘',()=>{
 let g=newGame();g=toggle(g);assert.equal(g.mode,'running');g=tick(g);const cells=g.cells;g=toggle(g);assert.equal(g.mode,'paused');g=tick(g);assert.deepEqual(g.cells,cells);g=toggle(g);assert.equal(g.mode,'running');assert.deepEqual(g.cells,cells)
})
test('禁止反向，碰撞后重开',()=>{
 let g=toggle(newGame());g=turn(g,[-1,0]);assert.deepEqual(g.next,[1,0]);for(let i=0;i<20;i++)g=tick(g);assert.equal(g.mode,'ended');assert.equal(toggle(g).mode,'running')
})
