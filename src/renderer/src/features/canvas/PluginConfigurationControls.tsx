import {useEffect,useRef,useState} from 'react'
import {PluginSettingsDialog} from './PluginSettingsDialog'
import {PluginSettingsIcon} from './PluginSettingsIcon'
import type {PluginInfo} from '../../../../shared/types'
export function PluginConfigurationControls({plugin,initialOpen=false,onClose}:{plugin:PluginInfo;initialOpen?:boolean;onClose?:()=>void}):JSX.Element{
 const [open,setOpen]=useState(initialOpen),[busy,setBusy]=useState(false),[configured,setConfigured]=useState<string[]|null>(null),[draft,setDraft]=useState<Record<string,string|null>>({}),[message,setMessage]=useState('')
 const generation=useRef(0)
 const trigger=useRef<HTMLButtonElement>(null)
 const directoryOnly=!!plugin.config?.fields.length&&plugin.config.fields.every(f=>f.type==='directory')
 const label=directoryOnly?'授权目录':'连接设置'
 const purpose=directoryOnly?'选择允许 AI 访问的文件夹，并管理目录权限':'填写此插件所需的连接信息，并测试是否连通'
 useEffect(()=>()=>{generation.current++},[plugin.id])
 const run=async(action:'status'|'save'|'directory'|'test'|'clear',field?:string)=>{
  const seq=++generation.current;setBusy(true)
  try{
   const result=await window.api.plugins.configuration(action,plugin.id,action==='save'?draft:action==='directory'?field:undefined)
   if(seq!==generation.current)return
   if(result.ok){setConfigured(result.configured);setMessage(action==='test'?`连接测试通过：发现 ${result.tools} 个工具；未执行业务操作`:action==='clear'?'本地配置已清除；原连接已关闭，服务商授权需到上游撤销':action==='save'?'配置已保存；尚未测试连接，不代表插件可调用':'配置状态已刷新')}
   else {setConfigured(null);setMessage(result.error)}
  }catch{if(seq===generation.current)setMessage('配置操作失败，请重试')}
  finally{if(seq===generation.current){setBusy(false);if(action==='save'||action==='clear')setDraft({})}}
 }
 useEffect(()=>{if(initialOpen)void run('status')},[])
 return <div className="pm-card-settings" data-plugin-config={plugin.id}>
  {!initialOpen&&<div className="pm-setting-entry"><button className="pm-settings-trigger" ref={trigger} type="button" title={purpose} aria-label={label+'：'+purpose} disabled={busy} onClick={()=>{setOpen(!open);setDraft({});if(!open)void run('status')}}><PluginSettingsIcon/><span>{label}</span></button><span className="pm-setting-tip" role="tooltip">{purpose}</span></div>}
  {open&&<PluginSettingsDialog returnFocus={trigger} title={plugin.displayName} busy={busy} onClose={()=>{setOpen(false);setDraft({});generation.current++;onClose?.()}}><form autoComplete="off" onSubmit={e=>{e.preventDefault();void run('save')}}>
   <p className="pm-settings-intro">{purpose}。信息仅保存在本机；安装不代表已授权或已连接。</p>
   {plugin.config?.fields.map(field=><label key={field.id} className="pm-config-field">
    <span>{field.label}{field.required?'（必填）':''} · {configured===null?'状态未知':configured.includes(field.id)?field.type==='directory'?'已保存目录授权':'已保存，留空保留':'未配置'}</span>
    <span className="pm-cd">{field.purpose}</span>
    {field.type==='directory'?<span className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>void run('directory',field.id)}>选择目录（{field.access==='read'?'只读':'读写'}授权）</button></span>:field.type==='enum'?<select disabled={busy} value={draft[field.id]??''} onChange={e=>setDraft(d=>({...d,[field.id]:e.target.value}))}><option value="" disabled>选择选项（不改则保留）</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input disabled={busy} autoComplete="off" type={field.type==='secret'?'password':'text'} maxLength={field.type==='string'?field.maxLength:16384} value={draft[field.id]??''} onChange={e=>setDraft(d=>{const n={...d};if(e.target.value)n[field.id]=e.target.value;else delete n[field.id];return n})}/>}
    {!field.required&&field.type!=='directory'&&<button type="button" disabled={busy} onClick={()=>setDraft(d=>({...d,[field.id]:null}))}>{draft[field.id]===null?'保存时清除':'清除此项'}</button>}
   </label>)}
   <div className="pm-auth-actions pm-settings-primary">{plugin.config?.fields.some(f=>f.type!=='directory')&&<button className="pm-settings-save" type="submit" disabled={busy||!Object.keys(draft).length}>保存配置</button>}{plugin.config?.startup!=='deferred'&&<button type="button" disabled={busy||!!Object.keys(draft).length} onClick={()=>void run('test')}>测试连接</button>}<button type="button" disabled={busy} onClick={()=>void run('status')}>刷新配置状态</button></div>
   {plugin.config?.startup==='deferred'&&<p className="pm-cd">保存后关闭设置，重新打开插件，在引导页验证服务连接。发现工具不等于服务验证通过。</p>}
   {message.includes('锁定')&&<p className="pm-cd">请先关闭此设置，点击软件顶部「密钥」，解锁或首次设置本机密钥柜，再返回这里保存。密钥柜解锁码与 TypeSafe API 密钥不是同一个东西。</p>}
   <div className="pm-cd" role="status">{busy?'配置操作中…':message}</div>
   <div className="pm-settings-danger"><p>断开将清除本地配置和目录授权，不删除业务文件；服务商授权需另行撤销。</p><div className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>void run('clear')}>断开并清除配置</button></div></div>
  </form></PluginSettingsDialog>}
 </div>
}
