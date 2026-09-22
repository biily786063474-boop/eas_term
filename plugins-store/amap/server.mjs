#!/usr/bin/env node
import readline from 'node:readline'
import {createAmapClient} from './lib/client.mjs'
import {amapJSON} from './lib/network.mjs'
const client=createAmapClient(JSON.parse(process.env.EAS_PLUGIN_CONFIG||'null'),amapJSON);delete process.env.EAS_PLUGIN_CONFIG
const str={type:'string'},coord={type:'string',description:'高德GCJ-02经度,纬度，最多6位小数'}
const definitions=[
 ['geocode','地理编码：地址转高德坐标，可同时取得天气查询使用的adcode。',{address:{type:'string',maxLength:300},city:{type:'string',maxLength:100}},['address']],
 ['nearby','周边POI搜索，分页返回最多25条，不获取设备位置。',{location:coord,keywords:{type:'string',maxLength:100},radius:{type:'integer',minimum:1,maximum:50000,default:1000},limit:{type:'integer',minimum:1,maximum:25,default:10},page:{type:'integer',minimum:1,maximum:100,default:1}},['location','keywords']],
 ['route','查询步行或驾车路线及文字步骤，仅规划参考，不是实时导航。',{origin:coord,destination:coord,mode:{type:'string',enum:['walking','driving'],default:'walking'}},['origin','destination']]
]
const tools=definitions.map(([name,description,properties,required])=>({name:'amap_'+name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}))
const send=message=>process.stdout.write(JSON.stringify(message)+'\n')
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
let queue=Promise.resolve()
async function handle(message){
 if(message.id===undefined)return
 const reply=result=>send({jsonrpc:'2.0',id:message.id,result})
 switch(message.method){
  case 'initialize':return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'eas-amap',version:'1.0.0'}})
  case 'ping':return reply({})
  case 'tools/list':return reply({tools})
  case 'tools/call':{
   try{
    const name=message.params?.name
    if(!['amap_geocode','amap_nearby','amap_route'].includes(name))throw Error('Unknown Amap tool')
    const result=await client[name.slice(5)](message.params.arguments)
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
