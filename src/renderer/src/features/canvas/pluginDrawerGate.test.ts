import test from 'node:test'
import assert from 'node:assert/strict'
import type { PluginInfo } from '../../../../shared/types.ts'
import { panelEligible, missingRequiredSecrets } from './pluginDrawerGate.ts'
const base = { id:'eas:jev',cli:'eas',name:'jev',displayName:'Jev',root:'/tmp/jev',enabled:true,panels:[{id:'main',title:'Jev',entry:'ui://jev/panel',defaultSize:{w:800,h:600}}],config:{startup:'deferred',fields:[{id:'api-key',type:'secret',label:'API Key',purpose:'连接',required:true}]}} as PluginInfo
test('only enabled installed Eas plugins with a panel can open drawer popup',()=>{
 assert.equal(panelEligible(base),true)
 assert.equal(panelEligible({...base,enabled:false}),false)
 assert.equal(panelEligible({...base,cli:'claude'}),false)
 assert.equal(panelEligible({...base,panels:[]}),false)
})
test('only missing required secret fields gate the panel',()=>{
 assert.deepEqual(missingRequiredSecrets(base,[]),['api-key'])
 assert.deepEqual(missingRequiredSecrets(base,['api-key']),[])
 assert.deepEqual(missingRequiredSecrets({...base,config:{...base.config!,fields:[{id:'path',type:'directory',label:'目录',purpose:'访问',required:true,access:'read'}]}} as PluginInfo,[]),[])
})
