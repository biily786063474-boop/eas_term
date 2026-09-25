import {useEffect,useRef,useState} from 'react'
import {PluginSettingsDialog} from './PluginSettingsDialog'
import {PluginSettingsIcon} from './PluginSettingsIcon'
import {VaultGate} from '../workspace/VaultGate'
import type {PluginInfo} from '../../../../shared/types'
export function PluginConfigurationControls({plugin,initialOpen=false,onClose}:{plugin:PluginInfo;initialOpen?:boolean;onClose?:()=>void}):JSX.Element{
 const [open,setOpen]=useState(initialOpen),[busy,setBusy]=useState(false),[configured,setConfigured]=useState<string[]|null>(null),[draft,setDraft]=useState<Record<string,string|null>>({}),[message,setMessage]=useState('')
 const [unlockFor,setUnlockFor]=useState<{action:'save'|'directory'|'test'|'clear';field?:string}|null>(null)
 const [vaultStatus,setVaultStatus]=useState<Awaited<ReturnType<typeof window.api.secrets.status>>|null>(null)
 const generation=useRef(0)
 const trigger=useRef<HTMLButtonElement>(null)
 const directoryOnly=!!plugin.config?.fields.length&&plugin.config.fields.every(f=>f.type==='directory')
 const label=directoryOnly?'授权目录':'连接设置'
 const purpose=directoryOnly?'选择允许 AI 访问的文件夹，并管理目录权限':'填写此插件所需的连接信息，并测试是否连通'
 useEffect(()=>()=>{generation.current++},[plugin.id])
 const run=async(action:'status'|'save'|'directory'|'test'|'clear',field?:string)=>{
  const seq=++generation.current;setBusy(true)
  let succeeded=false
  try{
   if(action!=='status'){
    const vault=await window.api.secrets.status()
    if(seq!==generation.current)return
    if(vault.locked){setVaultStatus(vault);setUnlockFor({action,field});setMessage('先解锁密钥柜，随后继续刚才的操作。输入的密钥会保留。');return}
   }
   const result=await window.api.plugins.configuration(action,plugin.id,action==='save'?draft:action==='directory'?field:undefined)
   if(seq!==generation.current)return
   if(result.ok){succeeded=true;setConfigured(result.configured);setMessage(action==='test'?`连接测试通过：发现 ${result.tools} 个工具；未执行业务操作`:action==='clear'?'本地配置已清除；原连接已关闭，服务商授权需到上游撤销':action==='save'?'已保存到本机插件专属加密凭证库；尚未测试连接':'配置状态已刷新')}
   else {if(action==='status')setConfigured(null);setMessage(result.error)}
  }catch{if(seq===generation.current)setMessage('配置操作失败，请重试')}
  finally{if(seq===generation.current){setBusy(false);if(succeeded&&(action==='save'||action==='clear'))setDraft({})}}
 }
 useEffect(()=>{if(initialOpen)void run('status')},[])
 return <div className="pm-card-settings" data-plugin-config={plugin.id}>
  {!initialOpen&&<div className="pm-setting-entry"><button className="pm-settings-trigger" ref={trigger} type="button" title={purpose} aria-label={label+'：'+purpose} disabled={busy} onClick={()=>{setOpen(!open);setDraft({});if(!open)void run('status')}}><PluginSettingsIcon/><span>{label}</span></button><span className="pm-setting-tip" role="tooltip">{purpose}</span></div>}
  {open&&<PluginSettingsDialog returnFocus={trigger} title={plugin.displayName} busy={busy} onClose={()=>{setOpen(false);setDraft({});setUnlockFor(null);generation.current++;onClose?.()}}>{unlockFor&&vaultStatus?<div className="pm-vault-unlock"><p className="pm-settings-intro">先解锁密钥柜，完成后会继续{unlockFor.action==='save'?'保存配置':unlockFor.action==='test'?'测试连接':'刚才的操作'}。你输入的配置不会丢失。</p><VaultGate status={vaultStatus} onUnlocked={()=>{const next=unlockFor;setUnlockFor(null);setVaultStatus(null);if(next)void run(next.action,next.field)}}/><button type="button" onClick={()=>{setUnlockFor(null);setVaultStatus(null)}}>返回插件设置</button></div>:<form autoComplete="off" onSubmit={e=>{e.preventDefault();void run('save')}}>
   <p className="pm-settings-intro">{purpose}。密钥保存在本机插件专属加密凭证库，由密钥柜解锁保护，不会出现在通用密钥列表；安装不代表已连接。</p>
   {plugin.config?.fields.map(field=><label key={field.id} className="pm-config-field">
    <span>{field.label}{field.required?'（必填）':''} · {configured===null?'状态未知':configured.includes(field.id)?field.type==='directory'?'已保存目录授权':'已保存，留空保留':'未配置'}</span>
    <span className="pm-cd">{field.purpose}</span>
    {field.type==='directory'?<span className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>void run('directory',field.id)}>选择目录（{field.access==='read'?'只读':'读写'}授权）</button></span>:field.type==='enum'?<select disabled={busy} value={draft[field.id]??''} onChange={e=>setDraft(d=>({...d,[field.id]:e.target.value}))}><option value="" disabled>选择选项（不改则保留）</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input disabled={busy} autoComplete="off" type={field.type==='secret'?'password':'text'} maxLength={field.type==='string'?field.maxLength:16384} value={draft[field.id]??''} onChange={e=>setDraft(d=>{const n={...d};if(e.target.value)n[field.id]=e.target.value;else delete n[field.id];return n})}/>}
    {!field.required&&field.type!=='directory'&&<button type="button" disabled={busy} onClick={()=>setDraft(d=>({...d,[field.id]:null}))}>{draft[field.id]===null?'保存时清除':'清除此项'}</button>}
   </label>)}
   <div className="pm-auth-actions pm-settings-primary">{plugin.config?.fields.some(f=>f.type!=='directory')&&<button className="pm-settings-save" type="submit" disabled={busy||!Object.keys(draft).length}>保存配置</button>}{plugin.config?.startup!=='deferred'&&<button type="button" disabled={busy||!!Object.keys(draft).length} onClick={()=>void run('test')}>测试连接</button>}<button type="button" disabled={busy} onClick={()=>void run('status')}>刷新配置状态</button></div>
   {plugin.config?.startup==='deferred'&&<p className="pm-cd">保存后关闭设置，重新打开插件，在引导页验证服务连接。发现工具不等于服务验证通过。</p>}
   {message.includes('锁定')&&<p className="pm-cd">点击保存或测试时会在这里提示解锁。密钥柜六位码与 TypeSafe API 密钥不是同一个东西。</p>}
   <div className="pm-cd" role="status">{busy?'配置操作中…':message}</div>
   <div className="pm-settings-danger"><p>断开将清除本地配置和目录授权，不删除业务文件；服务商授权需另行撤销。</p><div className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>void run('clear')}>断开并清除配置</button></div></div>
  </form>}</PluginSettingsDialog>}
 </div>
}
