import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {record} from './store.mjs'
import {weeklyReport} from './weekly.mjs'
test('weekly report crosses months, dedupes outcomes, excludes candidates and respects projects',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'timeline-week-'))
 try {
  const a=path.join(root,'a'),b=path.join(root,'b');fs.mkdirSync(a);fs.mkdirSync(b)
  const base={taskKey:'one',title:'成果一',summary:'说明',date:'2026-08-31',status:'verified',evidence:['测试通过']}
  record(a,base);record(a,{...base,title:'成果一更新'})
  record(a,{...base,taskKey:'two',date:'2026-09-01',status:'accepted'})
  record(b,{...base,taskKey:'three',date:'2026-09-02',status:'pending'})
  record(a,{...base,taskKey:'old',date:'2026-08-30'})
  const projects=[{id:'a',name:'A',cwd:a},{id:'b',name:'B',cwd:b}]
  const r=weeklyReport(projects,{},new Date(2026,8,3))
  assert.equal(r.total,3);assert.equal(r.activeDays,3);assert.deepEqual(r.statuses,{pending:1,verified:1,accepted:1})
  assert.equal(r.from,'2026-08-31');assert.equal(r.to,'2026-09-03');assert.equal(r.highlights[0].status,'accepted')
  assert.equal(weeklyReport(projects,{projectIds:['a']},new Date(2026,8,3)).total,2)
  assert.equal(weeklyReport(projects,{week:-1},new Date(2026,8,3)).total,1)
  assert.throws(()=>weeklyReport(projects,{week:2}),/周/)
  assert.throws(()=>weeklyReport(projects,{projectIds:['unauthorized']}),/授权/)
  const partial=weeklyReport([...projects,{id:'missing',name:'缺失',cwd:path.join(root,'missing')}],{},new Date(2026,8,3))
  assert.equal(partial.partial,true);assert.equal(partial.total,3)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('report totals are not capped by the 200 item list page and candidate files are ignored',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'timeline-week-pages-'))
 try {
  record(root,{taskKey:'seed',title:'成果',summary:'说明',date:'2026-09-21'})
  const file=path.join(root,'.eas/timeline.json'),data=JSON.parse(fs.readFileSync(file,'utf8')),seed=data.items[0]
  data.items=Array.from({length:205},(_,i)=>({...seed,id:'id-'+i,taskKey:'task-'+i}));fs.writeFileSync(file,JSON.stringify(data))
  fs.writeFileSync(path.join(root,'.eas/timeline-candidates.json'),'not read by reports')
  const projects=[{id:'p',name:'项目',cwd:root}]
  assert.equal(weeklyReport(projects,{},new Date(2026,8,22)).total,205)
  assert.equal(weeklyReport(projects,{projectIds:[]},new Date(2026,8,22)).total,0)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
