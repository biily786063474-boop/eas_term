import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
const source=fs.readFileSync(new URL('./CanvasStage.tsx',import.meta.url),'utf8')
const helper=new URL('./projectMenuOrder.ts',import.meta.url)
const implementation=fs.existsSync(helper)?fs.readFileSync(helper,'utf8').replace('export function','function'):
 'function orderProjectMenu(projects,mode,projectMru,rows){const st={projects,projectMru};const rank=new Map(rows.map((r,i)=>[r.projectId,i]));const mru=new Map(projectMru.map((id,i)=>[id,i]));'+source.slice(source.indexOf('const ordered = [...st.projects]'),source.indexOf('const list: CanvasMenuItem[] = ordered.map'))+';return ordered}'
const sort=runInNewContext(transformSync(implementation,{loader:'ts',format:'cjs'}).code+';orderProjectMenu')
test('recent means recency including a new project before old status rows',()=>{
 const projects=[{id:'old'},{id:'new'}],rows=[{projectId:'old'}]
 assert.deepEqual(Array.from(sort(projects,'recent',['new','old'],rows),(p:any)=>p.id),['new','old'])
 assert.deepEqual(Array.from(sort(projects,'recent',['old','new'],rows),(p:any)=>p.id),['old','new'])
 assert.deepEqual(projects.map(p=>p.id),['old','new'])
})
test('default keeps status ordering and recent ties stay stable',()=>{
 const projects=[{id:'a'},{id:'b'},{id:'c'}]
 assert.deepEqual(Array.from(sort(projects,'default',['a'],[{projectId:'b'}]),(p:any)=>p.id),['b','a','c'])
 assert.deepEqual(Array.from(sort(projects,'recent',[],[]),(p:any)=>p.id),['a','b','c'])
})
