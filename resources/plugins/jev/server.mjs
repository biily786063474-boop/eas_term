#!/usr/bin/env node
import {publicError} from './lib/errors.mjs'
import readline from 'node:readline'
import fs from 'node:fs'
import {usageStore} from './lib/usage.mjs'
import {preferenceStore} from './lib/preferences.mjs'
import {createRuntime} from './lib/runtime.mjs'
import {createService} from './lib/service.mjs'
const panel=fs.readFileSync(new URL('./ui/panel.html',import.meta.url),'utf8')
const usage=usageStore(process.env.EAS_PLUGIN_DATA)
const skills=Object.fromEntries(['triage','docs','eval','route','custom'].map(key=>[key,fs.readFileSync(new URL('./skills/'+key+'.md',import.meta.url),'utf8')]))
const service=createService({panel,usage,skills,runtime:createRuntime({preferences:preferenceStore(process.env.EAS_PLUGIN_DATA),usage})})
const requests=new Map()
const rl=readline.createInterface({input:process.stdin})
function send(value){process.stdout.write(JSON.stringify(value)+'\n')}
rl.on('line',async line=>{
 if(Buffer.byteLength(line)>160000)return
 let msg
 try{msg=JSON.parse(line)}catch{return}
 if(msg?.method==='notifications/cancelled'){requests.get(msg.params?.requestId)?.abort();return}
 if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||msg.id===undefined)return
 const controller=new AbortController();requests.set(msg.id,controller)
 try{
  const result=await service.handle(msg.method,msg.params??{},{signal:controller.signal})
  send({jsonrpc:'2.0',id:msg.id,result})
  if(['panel/grant','panel/revoke','host/configure'].includes(msg.method))send({jsonrpc:'2.0',method:'notifications/tools/list_changed'})
 }catch(error){
  // No raw transport exceptions, provider bodies or credential-bearing params in output.
  send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:publicError(error)}})
 }finally{requests.delete(msg.id)}
})
rl.on('close',()=>service.runtime.disconnect())
