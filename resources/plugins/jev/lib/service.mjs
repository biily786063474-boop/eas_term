import {adviseTimeline} from './timeline.mjs'
import {evaluate} from './client.mjs'
import {createRuntime} from './runtime.mjs'
export const PANEL_URI='ui://jev/panel'
const descriptions={
 triage:'对授权的多条记录进行分类与优先级判断；不读取账号或修改记录。',
 docs:'对已提供的资料进行相关性与证据核对；不自行读取文件。',
 eval:'按明确标准辅助评审已提供的结果；不是验收或合并授权。',
 route:'在已提供且已授权的候选中推荐工具或模型；不会实际切换。',
 custom:'对授权材料按自定义问题分类、评分或核对；不授权后续操作。'
}
const show={name:'jev_show',description:'打开 Jev 连接引导与能力面板。',inputSchema:{type:'object',properties:{},additionalProperties:false},_meta:{'ui/resourceUri':PANEL_URI}}
/** This dispatcher only runs inside the trusted plugin process.
 * panel/* transport must remain UI-only in the host; shim never forwards it. */
export function createService({panel,runtime=createRuntime(),verify=evaluate,usage,skills={}}){
 return {
  runtime,
  async handle(method,params={},context={}){
   if(method==='initialize')return {protocolVersion:params.protocolVersion??'2025-06-18',serverInfo:{name:'jev',version:'0.1.0'},capabilities:{tools:{listChanged:true},resources:{}}}
   if(method==='ping')return {}
   // Not included in panel or shim forwarding allowlists. Main supplies encrypted-store values.
   if(method==='host/configure'){
    let values
    try{values=JSON.parse(params.configuration)}catch{throw Error('Invalid host configuration')}
    const key=values?.['api-key']
    if(typeof key!=='string'||!key.trim())throw Error('Missing provider credential')
    runtime.disconnect()
    const requestId=usage?.reserve('connection')
    try{
     const result=await verify({state:'Connection verification only. No user data.',model:'jev-latest',questions:{connected:{type:'noul',instructions:'Does this text describe a connection verification?'}}},{key})
     if(requestId)usage.finish(requestId,'success',result.usage)
    }catch(error){if(requestId)usage.finish(requestId,'failed');throw error}
    runtime.connect(key)
    return {verified:true}
   }
   if(method==='host/timeline')return adviseTimeline(runtime,params,context)
   if(method==='panel/state')return runtime.snapshot()
   if(method==='panel/revoke'){runtime.pause();return runtime.snapshot()}
   if(method==='panel/grant'){
    if(params.action==='select')runtime.select(params.capability,params.enabled)
    else if(params.action==='all')runtime.selectAll(params.enabled)
    else if(params.action==='enable')runtime.enable()
    else throw Error('Unknown panel action')
    return runtime.snapshot()
   }
   if(method==='tools/list'){
    const state=runtime.snapshot()
    return {tools:[show,...Object.entries(descriptions).filter(([key])=>state.enabled&&state.selected[key]).map(([key,description])=>({
     name:'jev_'+key,description:description+' 需要用法时读取 jev://skills/'+key+'；不要提前加载全部说明。',inputSchema:{type:'object',properties:{state:{},questions:{type:'object'}},required:['state','questions'],additionalProperties:false}
    }))]}
   }
   if(method==='tools/call'){
    if(params.name==='jev_show')return {content:[{type:'text',text:'请在 Jev 面板连接并选择能力。'}],_meta:{'ui/resourceUri':PANEL_URI}}
    const key=typeof params.name==='string'?params.name.replace(/^jev_/,''):''
    if(!Object.hasOwn(descriptions,key))throw Error('Unknown Jev tool')
    const args=params.arguments??{}
    const result=await runtime.ask(key,{state:args.state,questions:args.questions,model:'jev-latest'},context)
    return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}
   }
   if(method==='resources/list'){const state=runtime.snapshot();return {resources:[{uri:PANEL_URI,name:'Jev',mimeType:'text/html;profile=mcp-app'},...Object.keys(descriptions).filter(key=>state.enabled&&state.selected[key]&&skills[key]).map(key=>({uri:'jev://skills/'+key,name:'Jev '+key+' 用法',mimeType:'text/markdown'}))]}}
   if(method==='resources/read'){
    if(typeof params.uri==='string'&&params.uri.startsWith('jev://skills/')){const key=params.uri.slice(13),state=runtime.snapshot();if(!Object.hasOwn(descriptions,key)||!state.enabled||!state.selected[key]||!skills[key])throw Error('Skill unavailable');return {contents:[{uri:params.uri,mimeType:'text/markdown',text:skills[key]}]}}
    if(params.uri!==PANEL_URI)throw Error('Unknown resource')
    return {contents:[{uri:PANEL_URI,mimeType:'text/html;profile=mcp-app',text:panel}]}
   }
   throw Error('Unknown method')
  }
 }
}
