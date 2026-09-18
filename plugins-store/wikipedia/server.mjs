#!/usr/bin/env node
import readline from 'node:readline'
import {createWikipediaClient} from './lib/client.mjs'
import {wikipediaJSON} from './lib/network.mjs'
const client=createWikipediaClient(wikipediaJSON)
const language={type:'string',enum:['zh','en'],default:'zh'}
const tools=[
 {name:'wikipedia_search',description:'只读搜索中英文维基百科，返回词条标题、片段和来源链接。',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:300},language,limit:{type:'integer',minimum:1,maximum:10,default:5}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'wikipedia_summary',description:'只读获取维基百科词条正文导言（纯文本，上限8000字符），不是全文，附来源链接。',inputSchema:{type:'object',properties:{title:{type:'string',maxLength:300},language},required:['title'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}
]
const send=message=>process.stdout.write(JSON.stringify(message)+'\n')
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
let queue=Promise.resolve()
async function handle(message){
 if(message.id===undefined)return
 const reply=result=>send({jsonrpc:'2.0',id:message.id,result})
 switch(message.method){
  case 'initialize':return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'eas-wikipedia',version:'1.0.0'}})
  case 'ping':return reply({})
  case 'tools/list':return reply({tools})
  case 'tools/call':{
   try{
    const name=message.params?.name
    if(!['wikipedia_search','wikipedia_summary'].includes(name))throw Error('Unknown Wikipedia tool')
    const result=await client[name==='wikipedia_search'?'search':'summary'](message.params.arguments)
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
