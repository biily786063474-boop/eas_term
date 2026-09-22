import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {randomUUID} from 'node:crypto'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
import {PluginEventBus,setPluginTurnReceiver,observePluginTurn} from './pluginEvents.ts'
// @ts-expect-error plugin is an independently executable JavaScript module
import {capture,candidates} from '../../resources/plugins/timeline/lib/candidates.mjs'
// @ts-expect-error standalone protocol
import {withEventGrantLock} from '../../resources/plugins/timeline/lib/eventAuthorization.mjs'
const tick=()=>new Promise(r=>setImmediate(r))
test('host grant connects existing sessions, excludes projects, hot toggles and restores settings',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'event-host-')),a=path.join(root,'a'),b=path.join(root,'b')
 fs.mkdirSync(a);fs.mkdirSync(b)
 t.after(()=>{setPluginTurnReceiver();fs.rmSync(root,{recursive:true,force:true})})
 const registered=[{id:'a',name:'Project A',path:a},{id:'b',name:'Project B',path:b}]
 fs.writeFileSync(path.join(root,'projects.json'),JSON.stringify(registered))
 const source=fs.readFileSync(new URL('./pluginEventHost.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')
 const compiled=stripTypeScriptTypes(source,{mode:'strip'})
 const create=()=>runInNewContext(compiled+'\n({initPluginEvents,eventPanel,eventProjects,invalidatePluginEvents})',{
  fs,path,randomUUID,withEventGrantLock,PluginEventBus,setPluginTurnReceiver,app:{getPath:()=>root},
  projectRootOf:(x:string)=>x,guardDir:(x:string)=>registered.some(p=>p.path===x)?{ok:true,path:x}:{ok:false},
 })
 const deliver=async(_name:string,event:unknown,p:{cwd:string})=>{capture(p.cwd,event)}
 const host=create();host.initPluginEvents((name:string)=>name==='timeline',deliver)
 const finish=(id:string,cwd:string)=>{observePluginTurn(id,cwd,{k:'text.done',text:'已完成独立成果'});observePluginTurn(id,cwd,{k:'turn.done'})}
 finish('before',a);await tick();assert.equal(candidates(a).length,0)
 observePluginTurn('already-open',a,{k:'turn.start'}) // no binding to timeline plugin
 host.eventPanel('timeline','panel/grant',{excluded:['b']})
 finish('already-open',a);finish('excluded',b);await tick()
 assert.equal(candidates(a).length,1);assert.equal(candidates(b).length,0)
 finish('queued',a);host.eventPanel('timeline','panel/revoke',{});await tick()
 assert.equal(candidates(a).length,1)
 finish('off',a);await tick();assert.equal(candidates(a).length,1)
 host.eventPanel('timeline','panel/grant',{excluded:[]});finish('new',b);await tick()
 assert.equal(candidates(b).length,1)
 assert.throws(()=>host.eventPanel('unknown','panel/grant',{}),/权限/)
 const restored=create();restored.initPluginEvents((name:string)=>name==='timeline',deliver)
 assert.equal(restored.eventPanel('timeline','panel/state',{}).enabled,true)
 finish('after-restart',a);await tick();assert.equal(candidates(a).length,2)
 // Path authorization errors never turn into arbitrary filesystem access.
 finish('unauthorized',os.tmpdir());await tick();assert.equal(candidates(a).length,2)
 finish('queued-before-update',a);restored.invalidatePluginEvents('timeline');await tick();assert.equal(candidates(a).length,2)
 finish('after-update',a);await tick();assert.equal(candidates(a).length,3)
 restored.eventPanel('timeline','panel/revoke',{})
})
