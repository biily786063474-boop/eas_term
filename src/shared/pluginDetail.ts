/** Public marketplace copy only. Never executable HTML or a source of granted permissions. */
export interface PluginDetail {
 summary?: string
 scenarios?: string[]
 steps?: string[]
 capabilities?: {title:string;description:string;kind:'tool'|'panel'|'suggestion';tool?:string}[]
 dataUse?: string
 limitations?: string
 changelog?: string
 supportUrl?: string
}
function obj(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('详情必须是对象')
 return value as Record<string,unknown>
}
function text(value:unknown,max:number):string{
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw Error('详情文本无效')
 return value.trim()
}
function list(value:unknown,maxItems:number,maxText:number):string[]{
 if(!Array.isArray(value)||value.length>maxItems)throw Error('详情列表过长')
 return value.map(v=>text(v,maxText))
}
export function parsePluginDetail(raw:unknown):PluginDetail|undefined{
 if(raw===undefined)return undefined
 const d=obj(raw),allowed=['summary','scenarios','steps','capabilities','dataUse','limitations','changelog','supportUrl']
 if(Object.keys(d).some(k=>!allowed.includes(k)))throw Error('详情包含未知字段')
 const result:PluginDetail={}
 if(d.summary!==undefined)result.summary=text(d.summary,1000)
 if(d.scenarios!==undefined)result.scenarios=list(d.scenarios,20,320)
 if(d.steps!==undefined)result.steps=list(d.steps,20,320)
 if(d.capabilities!==undefined){
  if(!Array.isArray(d.capabilities)||d.capabilities.length>32)throw Error('能力条目过多')
  result.capabilities=d.capabilities.map(value=>{
   const item=obj(value)
   if(Object.keys(item).some(k=>!['title','description','kind','tool'].includes(k)))throw Error('能力包含未知字段')
   if(item.kind!=='tool'&&item.kind!=='panel'&&item.kind!=='suggestion')throw Error('能力类型无效')
   if(item.tool!==undefined&&(item.kind!=='tool'||typeof item.tool!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(item.tool)))throw Error('工具名无效')
   return {title:text(item.title,100),description:text(item.description,500),kind:item.kind,...(item.tool!==undefined?{tool:item.tool}:{})}
  })
 }
 if(d.dataUse!==undefined)result.dataUse=text(d.dataUse,1000)
 if(d.limitations!==undefined)result.limitations=text(d.limitations,1000)
 if(d.changelog!==undefined)result.changelog=text(d.changelog,1000)
 if(d.supportUrl!==undefined){
  const value=text(d.supportUrl,500),url=new URL(value)
  if(url.protocol!=='https:'||url.username||url.password)throw Error('支持链接必须是 HTTPS')
  result.supportUrl=url.href
 }
 return result
}
