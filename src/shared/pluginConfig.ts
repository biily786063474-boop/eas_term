/** Declarative metadata only. Never contains values, paths, secrets or executable validators. */
export type PluginConfigField = {
 id: string
 label: string
 purpose: string
 required: boolean
} & (
 | {type:'string';maxLength:number}
 | {type:'enum';options:{value:string;label:string}[]}
 | {type:'secret'}
 | {type:'directory';access:'read'|'read-write'}
)
export interface PluginConfig {
 /** Explicit credential-free onboarding. No configuration is loaded at process spawn.
  * Credentials require a subsequent trusted-host activation and live vault lease. */
 startup?:'deferred'
 fields:PluginConfigField[]
}
const record=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('配置必须是对象')
 return v as Record<string,unknown>
}
function text(v:unknown,max:number):string{
 if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('配置文本无效')
 return v
}
function keys(r:Record<string,unknown>,allowed:string[]){
 if(Object.keys(r).some(k=>!allowed.includes(k)))throw Error('配置包含未知字段；不接受值、密钥或可执行校验')
}
/** Fail closed rather than silently dropping a required constraint. */
export function parsePluginConfig(raw:unknown):PluginConfig|undefined{
 if(raw===undefined)return undefined
 const c=record(raw);keys(c,['fields','startup'])
 if(c.startup!==undefined&&c.startup!=='deferred')throw Error('未知配置启动方式')
 if(!Array.isArray(c.fields)||!c.fields.length||c.fields.length>32)throw Error('配置字段数量必须为1–32')
 const ids=new Set<string>()
 const fields=c.fields.map((value):PluginConfigField=>{
  const f=record(value),id=text(f.id,40)
  if(!/^[a-z][a-z0-9-]*$/.test(id)||ids.has(id))throw Error('配置ID无效或重复')
  ids.add(id)
  const label=text(f.label,80),purpose=text(f.purpose,500)
  if(typeof f.required!=='boolean')throw Error('配置必须声明required')
  const base={id,label,purpose,required:f.required}
  const common=['id','type','label','purpose','required']
  switch(f.type){
   case 'string':{
    keys(f,[...common,'maxLength'])
    if(!Number.isSafeInteger(f.maxLength)||(f.maxLength as number)<1||(f.maxLength as number)>4096)throw Error('字符串必须声明1–4096长度上限')
    return {...base,type:'string' as const,maxLength:f.maxLength as number}
   }
   case 'enum':{
    keys(f,[...common,'options'])
    if(!Array.isArray(f.options)||!f.options.length||f.options.length>64)throw Error('枚举选项数量必须为1–64')
    const seen=new Set<string>()
    const options=f.options.map(v=>{const o=record(v);keys(o,['value','label']);const value=text(o.value,128),label=text(o.label,80);if(seen.has(value))throw Error('枚举值重复');seen.add(value);return {value,label}})
    return {...base,type:'enum' as const,options}
   }
   case 'secret':keys(f,common);return {...base,type:'secret' as const}
   case 'directory':{
    keys(f,[...common,'access'])
    if(f.access!=='read'&&f.access!=='read-write')throw Error('目录必须声明访问范围')
    return {...base,type:'directory' as const,access:f.access}
   }
   default:throw Error('未知配置类型')
  }
 })
 return {...(c.startup==='deferred'?{startup:'deferred' as const}:{}),fields}
}
