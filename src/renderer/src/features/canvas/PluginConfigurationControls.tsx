import {useEffect,useRef,useState} from 'react'
import type {PluginInfo} from '../../../../shared/types'
export function PluginConfigurationControls({plugin}:{plugin:PluginInfo}):JSX.Element{
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[configured,setConfigured]=useState<string[]|null>(null),[draft,setDraft]=useState<Record<string,string|null>>({}),[message,setMessage]=useState('')
 const generation=useRef(0)
 useEffect(()=>()=>{generation.current++},[plugin.id])
 const run=async(action:'status'|'save')=>{
  const seq=++generation.current;setBusy(true)
  try{
   const result=await window.api.plugins.configuration(action,plugin.id,action==='save'?draft:undefined)
   if(seq!==generation.current)return
   if(result.ok){setConfigured(result.configured);setMessage(action==='save'?'配置已保存；运行时注入尚未接通，不代表插件可调用':'配置状态已刷新')}
   else {setConfigured(null);setMessage(result.error)}
  }catch{if(seq===generation.current)setMessage('配置操作失败，请重试')}
  finally{if(seq===generation.current){setBusy(false);if(action==='save')setDraft({})}}
 }
 return <div className="pm-auth" data-plugin-config={plugin.id}>
  <div className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>{setOpen(!open);setDraft({});if(!open)void run('status')}}>{open?'关闭配置':'配置插件'}</button></div>
  {open&&<form autoComplete="off" onSubmit={e=>{e.preventDefault();void run('save')}}>
   {plugin.config?.fields.map(field=><label key={field.id} className="pm-config-field">
    <span>{field.label}{field.required?'（必填）':''} · {configured===null?'状态未知':configured.includes(field.id)?'已保存，留空保留':'未配置'}</span>
    <span className="pm-cd">{field.purpose}</span>
    {field.type==='directory'?<span className="pm-cd">目录选择器待接入 · {field.access==='read'?'只读':'读写'}授权，不能填写路径代替</span>:field.type==='enum'?<select disabled={busy} value={draft[field.id]??''} onChange={e=>setDraft(d=>({...d,[field.id]:e.target.value}))}><option value="" disabled>选择选项（不改则保留）</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input disabled={busy} autoComplete="off" type={field.type==='secret'?'password':'text'} maxLength={field.type==='string'?field.maxLength:16384} value={draft[field.id]??''} onChange={e=>setDraft(d=>{const n={...d};if(e.target.value)n[field.id]=e.target.value;else delete n[field.id];return n})}/>}
    {!field.required&&field.type!=='directory'&&<button type="button" disabled={busy} onClick={()=>setDraft(d=>({...d,[field.id]:null}))}>{draft[field.id]===null?'保存时清除':'清除此项'}</button>}
   </label>)}
   <div className="pm-auth-actions"><button type="submit" disabled={busy||!Object.keys(draft).length}>保存配置</button><button type="button" disabled={busy} onClick={()=>void run('status')}>刷新配置状态</button></div>
   <div className="pm-cd" role="status">{busy?'配置操作中…':message}</div>
  </form>}
 </div>
}
