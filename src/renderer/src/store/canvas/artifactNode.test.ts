import test from 'node:test'
import assert from 'node:assert/strict'
import { artifactNode } from './artifactNode.ts'
const node = {id:'same',x:4,y:8,w:300,h:200,pinned:true,pane:{kind:'image' as const,filePath:'/p/a.png'}}
test('同文件复用原节点，保留位置与固定状态',()=>{assert.equal(artifactNode([node],{kind:'image',filePath:'/p/a.png'}),node)})
test('不同文件、不同类型、live 节点不复用',()=>{assert.equal(artifactNode([node],{kind:'image',filePath:'/p/b.png'}),undefined);assert.equal(artifactNode([node],{kind:'code',filePath:'/p/a.png'}),undefined);assert.equal(artifactNode([{...node,leafId:'live'}],node.pane),undefined)})
test('HTML 同一 URL 复用，不跨 Frame 搜索',()=>{const web={...node,pane:{kind:'web' as const,url:'file:///p/a.html'}};assert.equal(artifactNode([web],web.pane),web);assert.equal(artifactNode([],web.pane),undefined)})
