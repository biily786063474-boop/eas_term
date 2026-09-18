import readline from 'node:readline'
import {createFiles} from './lib/files.mjs'
const files=createFiles(JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null'))
delete process.env.EAS_PLUGIN_CONFIG
const tools=[
 {name:'files_list',description:'列出授权目录中的文件（最多500项）。不跟随符号链接。',inputSchema:{type:'object',properties:{path:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'files_read',description:'读取授权目录中的UTF-8文本（最多1MB），返回SHA256供安全覆盖。',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'files_write',description:'写入授权目录中的UTF-8文本。覆盖必须提供当前文件SHA256；只读授权不能写入。',inputSchema:{type:'object',properties:{path:{type:'string'},text:{type:'string'},expectedSha256:{type:'string'}},required:['path','text'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}}
]
const send=m=>process.stdout.write(JSON.stringify(m)+'\n')
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
 let m;try{if(Buffer.byteLength(line)>2*1024*1024)throw Error();m=JSON.parse(line)}catch{return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})}
 if(!m||m.id===undefined)return
 const reply=result=>send({jsonrpc:'2.0',id:m.id,result})
 if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'eas-local-files',version:'1.0.0'}})
 if(m.method==='ping')return reply({})
 if(m.method==='tools/list')return reply({tools})
 if(m.method==='tools/call'){
  try{const name=m.params?.name;if(!tools.some(t=>t.name===name))throw Error('Unknown tool');return reply({content:[{type:'text',text:JSON.stringify(files[name.slice(6)](m.params.arguments))}]})}
  catch(e){return reply({isError:true,content:[{type:'text',text:e.code?'文件访问失败':String(e.message)}]})}
 }
 send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})
})
