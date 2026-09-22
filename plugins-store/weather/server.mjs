#!/usr/bin/env node
import readline from 'node:readline'
import {createWeatherClient} from './lib/client.mjs'
import {weatherJSON} from './lib/network.mjs'
const client=createWeatherClient(JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null'),weatherJSON);delete process.env.EAS_PLUGIN_CONFIG
const tools=['current','forecast'].map(kind=>({name:'weather_'+kind,description:kind==='current'?'查询高德支持地区的实况天气，保留数据发布时间。':'查询高德支持地区的未来天气预报，保留预报发布时间。',inputSchema:{type:'object',properties:{city:{type:'string',pattern:'^[0-9]{6}$',description:'高德行政区adcode，如110101'}},required:['city'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}))
const send=message=>process.stdout.write(JSON.stringify(message)+'\n')
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
let queue=Promise.resolve()
async function handle(message){
 if(message.id===undefined)return
 const reply=result=>send({jsonrpc:'2.0',id:message.id,result})
 switch(message.method){
  case 'initialize':return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'eas-weather',version:'1.0.0'}})
  case 'ping':return reply({})
  case 'tools/list':return reply({tools})
  case 'tools/call':{
   try{
    const name=message.params?.name
    if(!['weather_current','weather_forecast'].includes(name))throw Error('Unknown Weather tool')
    const result=await client[name==='weather_current'?'current':'forecast'](message.params.arguments)
    return reply({content:[{type:'text',text:JSON.stringify(result)}]})
   }catch(error){return reply({isError:true,content:[{type:'text',text:String(error.message)}]})}
  }
  default:return send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})
 }
}
lines.on('line',line=>{
 if(Buffer.byteLength(line)>65536){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}});return}
 let message;try{message=JSON.parse(line)}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return}
 if(!message||typeof message!=='object'||Array.isArray(message))return
 queue=queue.then(()=>handle(message)).catch(()=>{})
})
