import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {record} from './store.mjs'
import {listGlobal,getGlobal} from './global.mjs'
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'timeline-global-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return ['a','b'].map(id=>{const cwd=path.join(root,id);fs.mkdirSync(cwd);return {id,name:'项目'+id,cwd}})}
const value=(title,date)=>({taskKey:'same-task',title,summary:'已交付原文',date})
test('global dates and pagination are computed after union, same task key across projects survives',t=>{const p=fixture(t);record(p[0].cwd,value('甲','2026-09-17'));record(p[1].cwd,value('乙','2026-09-18'));const r=listGlobal(p,{month:'2026-09',limit:1});assert.equal(r.total,2);assert.deepEqual(r.days,{'2026-09-18':1,'2026-09-17':1});assert.equal(r.items[0].projectId,'b');assert.equal(r.nextOffset,1);assert.equal(listGlobal(p,{offset:1}).items[0].projectId,'a')})
test('project filters distinguish all / one / none and reject unknown IDs',t=>{const p=fixture(t);p.forEach(x=>record(x.cwd,value(x.name,'2026-09-18')));assert.equal(listGlobal(p,{projectIds:['b']}).total,1);assert.equal(listGlobal(p,{projectIds:[]}).total,0);assert.throws(()=>listGlobal(p,{projectIds:['unauthorized']}));assert.throws(()=>listGlobal(p,{projectIds:'a'}))})
test('details require matching project and record identity',t=>{const p=fixture(t),r=record(p[0].cwd,value('甲','2026-09-18'));assert.equal(getGlobal(p,{projectId:'a',id:r.id}).projectName,'项目a');assert.throws(()=>getGlobal(p,{projectId:'b',id:r.id}));assert.throws(()=>getGlobal(p,{projectId:'../x',id:r.id}))})
test('unavailable or corrupt project is reported, never hidden as empty global data',t=>{const p=fixture(t);record(p[0].cwd,value('甲','2026-09-18'));fs.mkdirSync(path.join(p[1].cwd,'.eas'));fs.writeFileSync(path.join(p[1].cwd,'.eas/timeline.json'),'broken');const r=listGlobal(p);assert.equal(r.total,1);assert.equal(r.partial,true);assert.equal(r.errors[0].projectId,'b');assert.equal(fs.readFileSync(path.join(p[1].cwd,'.eas/timeline.json'),'utf8'),'broken')})
test('duplicate roots are not counted twice and aliases remain filterable',t=>{const p=fixture(t);record(p[0].cwd,value('甲','2026-09-18'));const alias={...p[0],id:'alias'};assert.equal(listGlobal([...p,alias]).total,1);assert.equal(listGlobal([...p,alias],{projectIds:['alias']}).items[0].projectId,'alias')})
test('invalid pagination is rejected even with no selected projects',()=>{assert.throws(()=>listGlobal([],{limit:0}));assert.throws(()=>listGlobal([],{offset:-1}));assert.throws(()=>listGlobal([],{month:'2026-99'}))})
