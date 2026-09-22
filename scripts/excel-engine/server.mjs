import readline from 'node:readline'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createFiles} from './lib/files.mjs'
import {createConnector,tools} from './lib/connector.mjs'
const config=JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null');delete process.env.EAS_PLUGIN_CONFIG
const call=createConnector(path.dirname(fileURLToPath(import.meta.url)),createFiles(config))
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');let pending=Promise.resolve()
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{pending=pending.then(async()=>{
 let m;try{if(Buffer.byteLength(line)>5*1024*1024)throw Error();m=JSON.parse(line)}catch{return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})}
 if(!m||m.id===undefined)return;const reply=result=>send({jsonrpc:'2.0',id:m.id,result})
 if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'eas-excel',version:'1.1.0'}})
 if(m.method==='ping')return reply({})
 if(m.method==='tools/list')return reply({tools})
 if(m.method==='tools/call'){try{return reply({content:[{type:'text',text:JSON.stringify(await call(m.params?.name,m.params?.arguments))}]})}catch(e){return reply({isError:true,content:[{type:'text',text:e.code?'表格访问失败':String(e.message)}]})}}
 send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})
})})
