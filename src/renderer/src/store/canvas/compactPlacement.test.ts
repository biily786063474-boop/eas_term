import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactPlacement } from './compactPlacement.ts'
const opts = { gap: 22, startX: 16, startY: 50 }
test('successive squares form 2x2 without moving previous nodes', () => {
 const boxes: {x:number;y:number;w:number;h:number}[] = []
 for(let i=0;i<4;i++) boxes.push({...compactPlacement(boxes,400,400,opts),w:400,h:400})
 assert.deepEqual(boxes.map(({x,y})=>[x,y]), [[16,50],[438,50],[16,472],[438,472]])
})
test('fills deleted slot before growing the envelope', () => {
 const boxes=[{x:438,y:50,w:400,h:400},{x:16,y:472,w:400,h:400},{x:438,y:472,w:400,h:400}]
 assert.deepEqual(compactPlacement(boxes,400,400,opts),{x:16,y:50})
})
test('mixed sizes and child-frame obstacles keep gap and remain immutable', () => {
 const boxes=[{x:16,y:50,w:850,h:600},{x:16,y:672,w:200,h:300}]
 const before=JSON.stringify(boxes);const p=compactPlacement(boxes,440,380,opts)
 assert.equal(JSON.stringify(boxes),before)
 for(const b of boxes) assert.ok(p.x+440+22<=b.x || b.x+b.w+22<=p.x || p.y+380+22<=b.y || b.y+b.h+22<=p.y)
})
test('agent actual 640px minimum does not select a 440px-only hole', () => {
 const boxes=[{x:16,y:50,w:100,h:380},{x:600,y:50,w:640,h:380},{x:16,y:452,w:1224,h:380}]
 const before=JSON.stringify(boxes),p=compactPlacement(boxes,640,380,opts)
 for(const b of boxes) assert.ok(p.x+640+22<=b.x || b.x+b.w+22<=p.x || p.y+380+22<=b.y || b.y+b.h+22<=p.y)
 assert.equal(JSON.stringify(boxes),before)
})
test('four actual agent panes form two rows and two columns', () => {
 const boxes: {x:number;y:number;w:number;h:number}[]=[]
 for(let i=0;i<4;i++)boxes.push({...compactPlacement(boxes,640,380,opts),w:640,h:380})
 assert.equal(new Set(boxes.map(b=>b.x)).size,2)
 assert.equal(new Set(boxes.map(b=>b.y)).size,2)
})
