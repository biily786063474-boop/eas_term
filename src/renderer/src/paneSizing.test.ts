import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLayout, type LayoutNode, type LeafRect } from './layout.ts'
import { constrainPaneWidths, minimumTreeWidth } from './paneSizing.ts'
const agent = (id: string): LayoutNode => ({type:'leaf',id,pane:{kind:'agent',cwd:'/tmp'}})
const terminal: LayoutNode = {type:'leaf',id:'terminal',pane:{kind:'terminal',ptyId:'t'}}
const row = (a: LayoutNode,b: LayoutNode,ratio=.5): LayoutNode => ({type:'split',id:'r',dir:'row',ratio,children:[a,b]})

test('two chat panes retain 640px content widths in a narrow window without overlap', () => {
 const tree=row(agent('a'),agent('b'),.1)
 const width=Math.max(900,minimumTreeWidth(tree))
 const leaves: LeafRect[]=[]
 computeLayout(constrainPaneWidths(tree,width),{x:0,y:0,w:width,h:700},leaves,[])
 assert.equal(width,1292)
 assert.ok(leaves.every(l=>l.rect.w-6>=640))
 assert.equal(leaves[0].rect.x+leaves[0].rect.w,leaves[1].rect.x)
 assert.equal(tree.type==='split' && tree.ratio,.1)
})
test('nested vertical split shares width; terminal keeps its smaller minimum', () => {
 const stack: LayoutNode={type:'split',id:'v',dir:'column',ratio:.2,children:[agent('a'),agent('b')]}
 const tree=row(stack,terminal,.95)
 assert.equal(minimumTreeWidth(tree),772)
 const leaves: LeafRect[]=[]
 computeLayout(constrainPaneWidths(tree,1000),{x:0,y:0,w:1000,h:700},leaves,[])
 assert.ok(leaves.filter(l=>l.leaf.pane.kind==='agent').every(l=>l.rect.w-6>=640))
 assert.ok(leaves.find(l=>l.leaf.id==='terminal')!.rect.w-6>=120)
})
