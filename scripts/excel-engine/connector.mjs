import {runEngine} from './worker.mjs'
const str={type:'string'},revision={type:'string',pattern:'^[a-f0-9]{64}$'}
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false})
const cellValue={anyOf:[{type:'string',maxLength:32767},{type:'number'},{type:'boolean'},{type:'null'},object({formula:{type:'string',minLength:1,maxLength:2048}})]}
const series=object({name:str,categories:str,values:str})
const chart=object({type:{enum:['column','bar','line','pie','scatter']},name:str,categories:str,values:str,series:{type:'array',minItems:1,maxItems:20,items:series}},['type'])
const pivot=object({source:str,destination:str,name:str,rows:{type:'array',minItems:1,maxItems:20,items:str},columns:{type:'array',maxItems:20,items:str},data:{type:'array',minItems:1,maxItems:20,items:object({field:str,aggregate:{enum:['Sum','Count','Average','Min','Max']}})}},['source','destination','name','rows','data'])
const tool=(name,description,properties,required,readOnlyHint)=>({name,description,inputSchema:object({path:str,...properties},['path',...required]),annotations:{readOnlyHint,destructiveHint:!readOnlyHint}})
export const tools=[
 tool('excel_read','读取XLSX类型值、公式及已有缓存。日期为Excel序列值，不自动计算。',{},[],true),
 tool('excel_create','创建XLSX，字符串不自动作为公式；覆盖已有文件须当前SHA256。',{sheets:{type:'array',minItems:1,maxItems:20,items:object({name:str,rows:{type:'array',maxItems:10000,items:{type:'array',maxItems:1000,items:cellValue}}})},expectedSha256:revision},['sheets'],false),
 tool('excel_update','更新单元格并保留受支持的图表与透视结构；拒绝合并单元格和危险工作簿。须当前SHA256。',{sheet:str,cells:{type:'array',minItems:1,maxItems:1000,items:object({address:str,value:cellValue})},expectedSha256:revision},['sheet','cells','expectedSha256'],false),
 tool('excel_calculate','计算指定公式单元格，返回结果；不修改文件或声称所有Excel函数均支持。',{sheet:str,cell:str},['sheet','cell'],true),
 tool('excel_chart','添加原生图表，可指定多系列；name按文字处理，不是公式。须当前SHA256。',{sheet:str,cell:str,chart,expectedSha256:revision},['sheet','cell','chart','expectedSha256'],false),
 tool('excel_pivot','添加原生透视表定义，需Excel刷新后显示汇总，非预计算数据。须当前SHA256；请为输出预留空白区域。',{pivot,expectedSha256:revision},['pivot','expectedSha256'],false)
]
export function createConnector(packageRoot,files){
 return async(name,args)=>{
  const t=tools.find(t=>t.name===name)
  if(!t||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(t.inputSchema.properties,k))||t.inputSchema.required.some(k=>!Object.hasOwn(args,k)))throw Error('工具参数无效')
  if(typeof args.path!=='string'||!args.path.toLowerCase().endsWith('.xlsx'))throw Error('仅支持.xlsx')
  const operation=name.slice(6)
  const input={operation}
  if(operation==='create')input.sheets=args.sheets
  else{
   const file=files.read({path:args.path});input.workbook=file.buffer.toString('base64')
   if(!t.annotations.readOnlyHint&&file.sha256!==args.expectedSha256)throw Error('更新前必须提供当前文件SHA256')
   if(operation==='read')return {...await runEngine(packageRoot,input),sha256:file.sha256}
   if(operation==='update'){
    if(!Array.isArray(args.cells)||args.cells.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['address','value'].includes(k))||!Object.hasOwn(c,'value')))throw Error('单元格参数无效')
    input.changes=args.cells.map(c=>{
     const v=c.value
     if(v&&typeof v==='object'){
      if(Array.isArray(v)||Object.keys(v).length!==1||typeof v.formula!=='string')throw Error('公式参数无效')
      return {cell:c.address,formula:v.formula}
     }
     return {cell:c.address,value:v}
    })
   }
   for(const k of ['sheet','cell','chart','pivot'])if(Object.hasOwn(args,k))input[k]=args[k]
  }
  const result=await runEngine(packageRoot,input)
  if(operation==='calculate')return result
  const written=files.write({path:args.path,buffer:Buffer.from(result.workbook,'base64'),...(args.expectedSha256===undefined?{}:{expectedSha256:args.expectedSha256})})
  return {...written,...(result.note?{note:result.note}:{})}
 }
}
