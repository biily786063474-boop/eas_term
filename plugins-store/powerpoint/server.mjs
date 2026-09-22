import readline from 'node:readline'
import {createFiles} from './lib/files.mjs'
import {createPresentation,readPresentation,editPresentation} from './lib/presentation.mjs'
const files=createFiles(JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null'));delete process.env.EAS_PLUGIN_CONFIG
const slideSchema={type:'object',properties:{title:{type:'string',maxLength:2000},body:{type:'string',maxLength:10000}},required:['title'],additionalProperties:false}
const tools=[
 {name:'powerpoint_read',description:'按顺序读取PPTX幻灯片文字，返回编辑用文本索引，不执行视觉渲染。',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'powerpoint_create',description:'创建标题和正文文本幻灯片。只写授权目录，覆盖须当前SHA256。',inputSchema:{type:'object',properties:{path:{type:'string'},slides:{type:'array',minItems:1,maxItems:100,items:slideSchema},expectedSha256:{type:'string'}},required:['path','slides'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
 {name:'powerpoint_edit',description:'按0基幻灯片和文本索引替换一个文本run，保留其余ZIP部件；不会自动重排布局，长文本可能溢出。覆盖须当前SHA256。',inputSchema:{type:'object',properties:{path:{type:'string'},slide:{type:'integer',minimum:0},textIndex:{type:'integer',minimum:0},text:{type:'string',maxLength:10000},expectedSha256:{type:'string'}},required:['path','slide','textIndex','text','expectedSha256'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}}
]
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');let pending=Promise.resolve()
async function call(name,args){
 const tool=tools.find(t=>t.name===name);if(!tool||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k)))throw Error('工具参数无效')
 if(typeof args.path!=='string'||!args.path.toLowerCase().endsWith('.pptx'))throw Error('仅支持.pptx')
 if(name==='powerpoint_read'){const file=files.read({path:args.path});return {...await readPresentation(file.buffer),sha256:file.sha256}}
 if(name==='powerpoint_create')return files.write({path:args.path,buffer:await createPresentation({slides:args.slides}),...(args.expectedSha256===undefined?{}:{expectedSha256:args.expectedSha256})})
 const file=files.read({path:args.path});if(file.sha256!==args.expectedSha256)throw Error('更新前必须提供当前文件SHA256')
 return files.write({path:args.path,buffer:await editPresentation(file.buffer,{slide:args.slide,textIndex:args.textIndex,text:args.text}),expectedSha256:args.expectedSha256})
}
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{pending=pending.then(async()=>{
 let m;try{if(Buffer.byteLength(line)>5*1024*1024)throw Error();m=JSON.parse(line)}catch{return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})}
 if(!m||m.id===undefined)return;const reply=result=>send({jsonrpc:'2.0',id:m.id,result})
 if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'eas-powerpoint',version:'1.0.1'}})
 if(m.method==='ping')return reply({})
 if(m.method==='tools/list')return reply({tools})
 if(m.method==='tools/call'){try{return reply({content:[{type:'text',text:JSON.stringify(await call(m.params?.name,m.params?.arguments))}]})}catch(e){return reply({isError:true,content:[{type:'text',text:e.code?'演示文稿访问失败':String(e.message)}]})}}
 send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})
})})
