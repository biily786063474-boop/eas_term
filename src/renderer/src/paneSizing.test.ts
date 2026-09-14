import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLayout, type LayoutNode, type LeafRect } from './layout.ts'
import { constrainPaneWidths, minimumTreeWidth, paneMinimumWidth } from './paneSizing.ts'
const agent = (id: string): LayoutNode => ({type:'leaf',id,pane:{kind:'agent',cwd:'/tmp'}})
const terminal: LayoutNode = {type:'leaf',id:'terminal',pane:{kind:'terminal',ptyId:'t'}}
const row = (a: LayoutNode,b: LayoutNode,ratio=.5): LayoutNode => ({type:'split',id:'r',dir:'row',ratio,children:[a,b]})

test('split chats can shrink below canvas minimum without overlap', () => {
 const tree=row(agent('a'),agent('b'),.1)
 const width=Math.max(900,minimumTreeWidth(tree))
 const leaves: LeafRect[]=[]
 computeLayout(constrainPaneWidths(tree,width),{x:0,y:0,w:width,h:700},leaves,[])
 assert.equal(width,900)
 assert.equal(paneMinimumWidth('agent'),640)
 assert.ok(leaves.every(l=>l.rect.w-6>=320))
 assert.equal(leaves[0].rect.x+leaves[0].rect.w,leaves[1].rect.x)
 assert.equal(tree.type==='split' && tree.ratio,.1)
})
test('nested vertical split shares width; terminal keeps its smaller minimum', () => {
 const stack: LayoutNode={type:'split',id:'v',dir:'column',ratio:.2,children:[agent('a'),agent('b')]}
 const tree=row(stack,terminal,.95)
 assert.equal(minimumTreeWidth(tree),452)
 const leaves: LeafRect[]=[]
 computeLayout(constrainPaneWidths(tree,1000),{x:0,y:0,w:1000,h:700},leaves,[])
 assert.ok(leaves.filter(l=>l.leaf.pane.kind==='agent').every(l=>l.rect.w-6>=320))
 assert.ok(leaves.find(l=>l.leaf.id==='terminal')!.rect.w-6>=120)
})
