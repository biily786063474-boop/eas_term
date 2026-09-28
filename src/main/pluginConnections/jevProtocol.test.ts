import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parseManifest} from '../pluginManifest.ts'
import {supportsJevDecisionsV2,jevAutomationAllowed} from './jevProtocol.ts'
const old={name:'jev',requirements:{capabilities:['config.deferred']}}
const modern={name:'jev',requirements:{capabilities:['jev.decisions.v2']}}
test('real parsed manifest retains validated protocol requirements',()=>{
 const raw=JSON.parse(fs.readFileSync(new URL('../../../resources/plugins/jev/plugin.json',import.meta.url),'utf8'))
 const parsed=parseManifest(raw,'/tmp/jev',{exists:()=>true})
 assert.equal(parsed.ok,true)
 if(parsed.ok)assert.equal(supportsJevDecisionsV2(parsed.info),true)
})
test('legacy verification must not opt into unsupported restore protocol',async()=>{
 for(const info of [old,{name:'other',requirements:modern.requirements}]){
  assert.equal(supportsJevDecisionsV2(info),false)
  let calls=0,proof=false
  const request=async(method:string)=>{assert.equal(method,'host/configure');calls++}
  await request('host/configure');proof=supportsJevDecisionsV2(info)
  if(supportsJevDecisionsV2(info)&&proof)await request('host/restore')
  assert.equal(calls,1);assert.equal(proof,false)
 }
 assert.equal(supportsJevDecisionsV2(modern),true)
})
test('legacy timeline grants remain active; v2 requires explicit project membership',()=>{
 const state={enabled:true,connected:true,selected:{milestone:true,project:false}}
 assert.equal(jevAutomationAllowed(old,state,'p1'),true)
 assert.equal(jevAutomationAllowed(modern,state,'p1'),false)
 assert.equal(jevAutomationAllowed(modern,{...state,projectIds:['p1']},'p1'),true)
 assert.equal(jevAutomationAllowed(old,{...state,enabled:false},'p1'),false)
})
test('host gates both restore entries and v2 grants; configuration proof is gated before vault access',()=>{
 const host=fs.readFileSync(new URL('../pluginHost.ts',import.meta.url),'utf8')
 const config=fs.readFileSync(new URL('../pluginConfiguration.ts',import.meta.url),'utf8')
 assert.match(host,/if\(supportsJevDecisionsV2\(info\)&&info.config\?\.startup==='deferred'\)/)
 assert.match(host,/if\(supportsJevDecisionsV2\(h.info\)\)\{/)
 assert.match(host,/const grant=supportsJevDecisionsV2\(h.info\)/)
 assert.match(host,/!supportsJevDecisionsV2\(jevInfo\)&&!registry.get\('jev'\)/)
 assert.match(host,/jevAutomationAllowed\(jevInfo,before,project.id\)/)
 assert.match(config,/markJevConfigurationVerified=[\s\S]*?=>supportsJevDecisionsV2\(info\)\?access/)
 assert.match(config,/canRestoreJevConfiguration=[\s\S]*?=>supportsJevDecisionsV2\(info\)&&access/)
})
