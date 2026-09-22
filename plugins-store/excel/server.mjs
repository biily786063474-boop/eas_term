import readline from 'node:readline'
import {createFiles} from './lib/files.mjs'
import {createWorkbook,readWorkbook,updateWorkbook} from './lib/workbook.mjs'
const files=createFiles(JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null'));delete process.env.EAS_PLUGIN_CONFIG
const cellValue={anyOf:[{type:'string',maxLength:32767},{type:'number'},{type:'boolean'},{type:'null'},{type:'object',properties:{formula:{type:'string',maxLength:2048}},required:['formula'],additionalProperties:false}]}
const tools=[
 {name:'excel_read',description:'读取XLSX单元格值与公式/旧缓存，不执行计算，不还原完整图表排版。',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'excel_create',description:'创建XLSX工作表。字符串不会自动转公式；显式公式只支持本表引用和数值白名单函数，由Excel打开时计算。覆盖须SHA256。',inputSchema:{type:'object',properties:{path:{type:'string'},sheets:{type:'array',maxItems:20,items:{type:'object',properties:{name:{type:'string',maxLength:31},rows:{type:'array',maxItems:10000,items:{type:'array',maxItems:1000,items:cellValue}}},required:['name','rows'],additionalProperties:false}},expectedSha256:{type:'string'}},required:['path','sheets'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
 {name:'excel_update',description:'按地址更新普通单元格，必须提供当前SHA256；含图表/透视/外部数据等复杂工作簿拒绝改写，避免丢失内容。',inputSchema:{type:'object',properties:{path:{type:'string'},sheet:{type:'string'},cells:{type:'array',maxItems:1000,items:{type:'object',properties:{address:{type:'string'},value:cellValue},required:['address','value'],additionalProperties:false}},expectedSha256:{type:'string'}},required:['path','sheet','cells','expectedSha256'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}}
]
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');let pending=Promise.resolve()
async function call(name,args){
 const tool=tools.find(t=>t.name===name);if(!tool||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k)))throw Error('工具参数无效')
 if(typeof args.path!=='string'||!args.path.toLowerCase().endsWith('.xlsx'))throw Error('仅支持.xlsx')
 if(name==='excel_read'){const file=files.read({path:args.path});return {...await readWorkbook(file.buffer),sha256:file.sha256}}
 if(name==='excel_create')return files.write({path:args.path,buffer:await createWorkbook({sheets:args.sheets}),...(args.expectedSha256===undefined?{}:{expectedSha256:args.expectedSha256})})
 const file=files.read({path:args.path});if(file.sha256!==args.expectedSha256)throw Error('更新前必须提供当前文件SHA256')
 return files.write({path:args.path,buffer:await updateWorkbook(file.buffer,{sheet:args.sheet,cells:args.cells}),expectedSha256:args.expectedSha256})
}
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{pending=pending.then(async()=>{
 let m;try{if(Buffer.byteLength(line)>5*1024*1024)throw Error();m=JSON.parse(line)}catch{return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})}
 if(!m||m.id===undefined)return;const reply=result=>send({jsonrpc:'2.0',id:m.id,result})
 if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'eas-excel',version:'1.0.1'}})
 if(m.method==='ping')return reply({})
 if(m.method==='tools/list')return reply({tools})
 if(m.method==='tools/call'){try{return reply({content:[{type:'text',text:JSON.stringify(await call(m.params?.name,m.params?.arguments))}]})}catch(e){return reply({isError:true,content:[{type:'text',text:e.code?'表格访问失败':String(e.message)}]})}}
 send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})
})})
