#!/usr/bin/env node
import readline from 'node:readline'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {record,list,get,review} from './lib/store.mjs'
import {weeklyReport} from './lib/weekly.mjs'
import {listGlobal,getGlobal} from './lib/global.mjs'
import {capture,candidates,resolveCandidate} from './lib/candidates.mjs'
import {captureAuthorized} from './lib/eventAuthorization.mjs'
const URI='ui://timeline/panel'
const instructions='在当前轮次交付可独立验收成果前调用 timeline_record；同一成果沿用 taskKey 和 date 更新，不以命令/提交次数计数。verified/accepted 必须有验证/用户确认依据。只按 taskKey/query 查询相关记录，不扫描全历史、不额外唤醒模型。收到成功回执才说已记录。普通问答无需调用；若收到补漏提醒且无成果可记，用 timeline_review 简短说明。'
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false})
const str={type:'string'}
const TOOLS=[
{name:'timeline_global_list',description:'查询已授权项目的全局成果摘要与热力图。',inputSchema:schema({month:str,date:str,query:str,projectIds:{type:'array',items:str},limit:{type:'integer'},offset:{type:'integer'}})},
{name:'timeline_global_get',description:'读取指定项目的一项成果。',inputSchema:schema({projectId:str,id:str},['projectId','id'])},
{name:'timeline_candidates',description:'查询待确认候选，不计入成果热力图。',inputSchema:schema({projectIds:{type:'array',items:str}})},

{name:'timeline_show',description:'打开项目时间线面板。不回传完整历史。',inputSchema:schema({}),_meta:{'ui/resourceUri':URI}},
{name:'timeline_list',description:'按月份/日期/taskKey/标题查询里程碑摘要（默认30，最多200）。按需读取，不每轮全量扫描。',inputSchema:schema({month:str,date:str,taskKey:str,query:str,limit:{type:'integer',minimum:1,maximum:200},offset:{type:'integer',minimum:0}})},
{name:'timeline_get',description:'按 ID 读取一项成果的详细说明与依据。',inputSchema:schema({id:str},['id'])},
{name:'timeline_record',description:'新增/更新一个独立成果。taskKey 为同一目标稳定标识；已有记录更新不重复计数，date 保留发生日。只在交付阶段调用，禁止把工具调用/普通问答拆成里程碑。回执只含ID与状态。',inputSchema:schema({taskKey:{type:'string',maxLength:100},title:{type:'string',maxLength:160},summary:{type:'string',maxLength:4000},date:{type:'string',description:'成果发生日 YYYY-MM-DD，本地日期；更新保留原日期'},status:{type:'string',enum:['pending','verified','accepted']},evidence:{type:'array',items:str,maxItems:12},artifacts:{type:'array',items:str,maxItems:12},author:str},['taskKey','title','summary','date'])},
{name:'timeline_review',description:'仅收到补漏提醒后，若上轮无需里程碑，用简短理由确认已检查；不会新增成果。',inputSchema:schema({reason:{type:'string',maxLength:120}},['reason'])}
]
function call(p){const cwd=p?._meta?.eas?.context?.cwd;if(typeof cwd!=='string'||!cwd)throw Error('缺少宿主项目上下文');const a=p.arguments??{},projects=p?._meta?.projects??[];switch(p.name){case 'timeline_global_list':return listGlobal(projects,a);case 'timeline_global_get':return getGlobal(projects,a);case 'timeline_candidates':{const ids=a.projectIds;if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>!projects.some(p=>p.id===id))))throw Error('项目筛选包含未授权项目');const errors=[],items=[];for(const p of projects.filter(x=>ids===undefined||ids.includes(x.id))){try{items.push(...candidates(p.cwd).map(c=>({...c,projectId:p.id,projectName:p.name})))}catch(e){errors.push({projectId:p.id,projectName:p.name,message:e.message})}}items.sort((a,b)=>b.source.completedAt.localeCompare(a.source.completedAt));return {total:items.length,items:items.slice(0,50),partial:!!errors.length,errors}}}switch(p.name){case 'timeline_show':return {ok:true,note:'时间线面板已请求打开'};case 'timeline_list':return list(cwd,a);case 'timeline_get':return get(cwd,a.id);case 'timeline_record':return record(cwd,a);case 'timeline_review':return review(a);default:throw Error('未知工具')}}
const send=m=>process.stdout.write(JSON.stringify(m)+'\n')
readline.createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.id===undefined)return;try{let result;switch(m.method){case 'initialize':result={protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{},resources:{}},serverInfo:{name:'timeline',version:'1.0.0'},instructions};break;case 'ping':result={};break;case 'tools/list':result={tools:TOOLS};break;case 'events/turn-completed':result=captureAuthorized(process.env.EAS_EVENT_GRANTS_FILE,process.env.EAS_EVENT_PLUGIN_NAME,m.params.grantEpoch,m.params.event?.projectId,()=>capture(m.params?._meta?.eas?.context?.cwd,m.params.event));break;case 'panel/timeline-report':result=weeklyReport(m.params?._meta?.projects??[],m.params);break;case 'panel/resolve-candidate':{const p=m.params?._meta?.projects?.find(p=>p.id===m.params.projectId);if(!p)throw Error('项目未授权');result=resolveCandidate(p.cwd,m.params.id,m.params.decision);break;}case 'tools/call':try{const data=call(m.params);result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}catch(e){result={isError:true,content:[{type:'text',text:e.message}]}}break;case 'resources/list':result={resources:[{uri:URI,name:'项目时间线',mimeType:'text/html;profile=mcp-app'}]};break;case 'resources/read':if(m.params?.uri!==URI)throw Error('未知资源');result={contents:[{uri:URI,mimeType:'text/html;profile=mcp-app',text:fs.readFileSync(fileURLToPath(new URL('./ui/panel.html',import.meta.url)),'utf8')}]};break;default:send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'不支持的方法'}});return}send({jsonrpc:'2.0',id:m.id,result})}catch(e){send({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:e.message}})}})
