import readline from 'node:readline'
import {createFiles} from './lib/files.mjs'
import {createDocument,readDocument,reviseDocument} from './lib/document.mjs'
const files=createFiles(JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null'))
delete process.env.EAS_PLUGIN_CONFIG
const pathSchema={type:'string',description:'授权目录内的相对.docx路径'}
const tools=[
 {name:'word_read',description:'读取DOCX正文顶层段落、顶层表格文本和SHA256，不包含页眉/文本框或嵌套表格内容；不执行宏或外部链接。',inputSchema:{type:'object',properties:{path:pathSchema},required:['path'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'word_create',description:'创建DOCX，支持标题、标题级别1–6、粗体、斜体与矩形文本表格（追加在段落后）；覆盖须提供当前SHA256。',inputSchema:{type:'object',properties:{path:pathSchema,title:{type:'string'},tables:{type:'array',maxItems:50,items:{type:'object',properties:{rows:{type:'array',minItems:1,maxItems:200,items:{type:'array',minItems:1,maxItems:50,items:{type:'string',maxLength:10000}}}},required:['rows'],additionalProperties:false}},paragraphs:{type:'array',maxItems:1000,items:{type:'object',properties:{text:{type:'string'},heading:{type:'integer',minimum:1,maximum:6},bold:{type:'boolean'},italic:{type:'boolean'}},required:['text'],additionalProperties:false}},expectedSha256:{type:'string'}},required:['path','paragraphs'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
 {name:'word_revise',description:'用跟踪修订替换正文顶层简单段落，保留被删除文本并写入作者。已有修订/域/链接/图片等复杂内容拒绝改写。必须提供当前SHA256。',inputSchema:{type:'object',properties:{path:pathSchema,paragraph:{type:'integer',minimum:0},text:{type:'string'},author:{type:'string'},expectedSha256:{type:'string'}},required:['path','paragraph','text','author','expectedSha256'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}}
]
const send=m=>process.stdout.write(JSON.stringify(m)+'\n')
async function call(name,args){
 const tool=tools.find(t=>t.name===name)
 if(!tool||!args||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k)))throw Error('工具参数无效')
 if(typeof args.path!=='string'||!args.path.toLowerCase().endsWith('.docx'))throw Error('仅支持.docx')
 if(name==='word_read'){const v=files.read({path:args.path});return {...await readDocument(v.buffer),sha256:v.sha256}}
 if(name==='word_create')return files.write({path:args.path,buffer:await createDocument({paragraphs:args.paragraphs,...(args.tables===undefined?{}:{tables:args.tables}),...(args.title===undefined?{}:{title:args.title})}),...(args.expectedSha256===undefined?{}:{expectedSha256:args.expectedSha256})})
 const v=files.read({path:args.path})
 if(v.sha256!==args.expectedSha256)throw Error('修订前必须提供当前文件SHA256')
 const buffer=await reviseDocument(v.buffer,{paragraph:args.paragraph,text:args.text,author:args.author})
 return files.write({path:args.path,buffer,expectedSha256:args.expectedSha256})
}
let pending=Promise.resolve()
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
 // Serialize mutations: two concurrent revisions must not share a stale hash.
 pending=pending.then(async()=>{
  let m;try{if(Buffer.byteLength(line)>5*1024*1024)throw Error();m=JSON.parse(line)}catch{return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})}
  if(!m||m.id===undefined)return
  const reply=result=>send({jsonrpc:'2.0',id:m.id,result})
  if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'eas-word',version:'1.0.0'}})
  if(m.method==='ping')return reply({})
  if(m.method==='tools/list')return reply({tools})
  if(m.method==='tools/call'){try{return reply({content:[{type:'text',text:JSON.stringify(await call(m.params?.name,m.params?.arguments))}]})}catch(e){return reply({isError:true,content:[{type:'text',text:e.code?'文档访问失败':String(e.message)}]})}}
  send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})
 })
})
