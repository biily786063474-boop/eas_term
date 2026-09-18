import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createConfigurationActions} from './configurationActions.ts'
import {CredentialLeases} from './credentialLease.ts'
const acquire=()=>new CredentialLeases(()=>true).acquire()
import type {PluginInfo} from '../../shared/types'
const info:PluginInfo={id:'eas:fixture',cli:'eas',name:'fixture',root:'/fixture',displayName:'Fixture',mcp:{command:'node',args:[],env:{},cwd:'/fixture'},config:{fields:[{id:'key',type:'secret',label:'Key',purpose:'连接服务',required:true},{id:'region',type:'enum',label:'区域',purpose:'选择服务区域',required:true,options:[{value:'cn',label:'中国'}]}]}}
function setup(){let current=structuredClone(info),values:Record<string,string>|undefined,allowed=true,locked=false,writes=0;const run=createConfigurationActions({acquire,find:()=>current,confirm:async()=>allowed,assertIdle:()=>{if(locked)throw Error('busy')},load:()=>values,save:(_i,v)=>{values=v;writes++}});return {run,values:()=>values,writes:()=>writes,cancel:()=>{allowed=false},busy:()=>{locked=true},change:()=>{current={...current,config:{fields:[]}}}}}
test('save validates fields, preserves omitted secrets and returns presence only',async()=>{
 const s=setup();assert.equal((await s.run('save',info.id,{key:'private',region:'cn'})).ok,true)
 const state=await s.run('status',info.id);assert.deepEqual(state,{ok:true,configured:['key','region']});assert.doesNotMatch(JSON.stringify(state),/private/)
 assert.equal((await s.run('save',info.id,{region:'cn'})).ok,true);assert.equal(s.values()?.key,'private')
 for(const patch of [{region:'us'},{key:null},{unknown:'x'},{key:3}])assert.equal((await s.run('save',info.id,patch)).ok,false)
 assert.equal(s.writes(),2)
})
test('cancel and active plugin block writes, directory strings do not grant access',async()=>{
 const s=setup();s.cancel();assert.equal((await s.run('save',info.id,{key:'private',region:'cn'})).ok,false);assert.equal(s.writes(),0)
 const b=setup();b.busy();assert.equal((await b.run('save',info.id,{key:'private',region:'cn'})).ok,false);assert.equal(b.writes(),0)
 let writes=0
 const dir={...info,config:{fields:[{id:'root',type:'directory' as const,label:'目录',purpose:'读文件',required:true,access:'read' as const}]}}
 const run=createConfigurationActions({acquire,find:()=>dir,confirm:async()=>true,assertIdle(){},load:()=>undefined,save:()=>{writes++}})
 assert.equal((await run('save',info.id,{root:'/Users'})).ok,false);assert.equal(writes,0)
})
test('manifest changes while confirmation is open cannot save into the new configuration',async()=>{
 let current=structuredClone(info),writes=0
 const run=createConfigurationActions({acquire,find:()=>current,confirm:async()=>{current={...current,mcp:{...current.mcp!,args:['different']}};return true},assertIdle(){},load:()=>undefined,save:()=>{writes++}})
 const result=await run('save',info.id,{key:'private',region:'cn'})
 assert.equal(result.ok,false);if(!result.ok)assert.match(result.error,/已变化/);assert.equal(writes,0)
})
test('native directory selection saves only host-provided grants and rechecks configuration after picker',async()=>{
 const dir:PluginInfo={...info,config:{fields:[{id:'root',type:'directory',label:'目录',purpose:'读取文件',required:true,access:'read'}]}}
 let values:Record<string,string>|undefined,current=dir
 const run=createConfigurationActions({acquire,find:()=>current,confirm:async()=>true,assertIdle(){},load:()=>values,save:(_i,v)=>{values=v},pickDirectory:async()=>'{"host":"grant"}'})
 assert.equal((await run('directory',info.id,'root')).ok,true);assert.equal(values?.root,'{"host":"grant"}')
 assert.equal((await run('save',info.id,{root:'/etc'})).ok,false)
 const stale=createConfigurationActions({acquire,find:()=>current,confirm:async()=>true,assertIdle(){},load:()=>values,save:()=>{throw Error('must not save')},pickDirectory:async()=>{current={...dir,root:'/changed'};return 'stale'}})
 const result=await stale('directory',info.id,'root');assert.equal(result.ok,false)
})

test('locking and unlocking during either native dialog irreversibly invalidates pending configuration',async()=>{
 const {CredentialLeases}=await import('./credentialLease.ts')
 for(const action of ['save','directory'] as const){
  let unlocked=true,writes=0,disposed=0
  const leases=new CredentialLeases(()=>unlocked)
  const invalidate=async()=>{unlocked=false;leases.invalidate();unlocked=true;return true}
  const current:PluginInfo={...info,config:{fields:[...info.config!.fields,{id:'root',type:'directory',label:'目录',purpose:'读取',required:false,access:'read'}]}}
  const run=createConfigurationActions({find:()=>current,confirm:invalidate,assertIdle(){},load:()=>({key:'old',region:'cn'}),save:()=>{writes++},pickDirectory:async()=>{await invalidate();return 'grant'},
   acquire:()=>{const lease=leases.acquire();return {...lease,dispose:()=>{disposed++;lease.dispose()}}}
  })
  const result=await run(action,info.id,action==='save'?{key:'late'}:'root')
  assert.equal(result.ok,false,action+' must reject the old vault session')
  assert.equal(writes,0);assert.equal(disposed,1)
 }
})
