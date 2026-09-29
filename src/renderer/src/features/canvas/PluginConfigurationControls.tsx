import {useEffect,useRef,useState} from 'react'
import {useT} from '../../i18n.ts'
import {PluginSettingsDialog} from './PluginSettingsDialog'
import {PluginSettingsIcon} from './PluginSettingsIcon'
import {VaultGate} from '../workspace/VaultGate'
import type {PluginInfo} from '../../../../shared/types'
import {WebView} from '../web/WebView'
export function PluginConfigurationControls({plugin,initialOpen=false,onClose}:{plugin:PluginInfo;initialOpen?:boolean;onClose?:()=>void}):JSX.Element{
 const tr=useT()
 const LOCK_MARK='锁定' // i18n-allow: 匹配主进程回的错误原文，不是展示文案
 const [open,setOpen]=useState(initialOpen),[busy,setBusy]=useState(false),[configured,setConfigured]=useState<string[]|null>(null),[draft,setDraft]=useState<Record<string,string|null>>({}),[message,setMessage]=useState('')
 const [keyBrowserOpen,setKeyBrowserOpen]=useState(false)
 const [unlockFor,setUnlockFor]=useState<{action:'save'|'directory'|'test'|'clear';field?:string}|null>(null)
 const [vaultStatus,setVaultStatus]=useState<Awaited<ReturnType<typeof window.api.secrets.status>>|null>(null)
 const generation=useRef(0)
 const trigger=useRef<HTMLButtonElement>(null)
 const directoryOnly=!!plugin.config?.fields.length&&plugin.config.fields.every(f=>f.type==='directory')
 const label=directoryOnly?tr('panels.pluginCfg.dirLabel'):tr('panels.pluginCfg.connLabel')
 const purpose=directoryOnly?tr('panels.pluginCfg.dirPurpose'):tr('panels.pluginCfg.connPurpose')
 useEffect(()=>()=>{generation.current++},[plugin.id])
 const run=async(action:'status'|'save'|'directory'|'test'|'clear',field?:string)=>{
  const seq=++generation.current;setBusy(true)
  let succeeded=false
  try{
   if(action!=='status'){
    const vault=await window.api.secrets.status()
    if(seq!==generation.current)return
    if(vault.locked){setVaultStatus(vault);setUnlockFor({action,field});setMessage(tr('panels.pluginCfg.unlockFirst'));return}
   }
   const result=await window.api.plugins.configuration(action,plugin.id,action==='save'?draft:action==='directory'?field:undefined)
   if(seq!==generation.current)return
   if(result.ok){succeeded=true;setConfigured(result.configured);setMessage(action==='test'?tr('panels.pluginCfg.testOk',{n:result.tools??0}):action==='clear'?tr('panels.pluginCfg.cleared'):action==='save'?tr('panels.pluginCfg.savedMsg'):tr('panels.pluginCfg.refreshed'))}
   else {if(action==='status')setConfigured(null);setMessage(result.error)}
  }catch{if(seq===generation.current)setMessage(tr('panels.pluginCfg.opFail'))}
  finally{if(seq===generation.current){setBusy(false);if(succeeded&&(action==='save'||action==='clear'))setDraft({})}}
 }
 useEffect(()=>{if(initialOpen)void run('status')},[])
 return <div className="pm-card-settings" data-plugin-config={plugin.id}>
  {!initialOpen&&<div className="pm-setting-entry"><button className="pm-settings-trigger" ref={trigger} type="button" title={purpose} aria-label={label+'：'+purpose} disabled={busy} onClick={()=>{setOpen(!open);setDraft({});if(!open)void run('status')}}><PluginSettingsIcon/><span>{label}</span></button><span className="pm-setting-tip" role="tooltip">{purpose}</span></div>}
  {open&&<PluginSettingsDialog wide={keyBrowserOpen} returnFocus={trigger} title={plugin.displayName} busy={busy} onClose={()=>{setKeyBrowserOpen(false);setOpen(false);setDraft({});setUnlockFor(null);generation.current++;onClose?.()}}>{keyBrowserOpen?<div className="pm-key-browser"><button type="button" className="pm-key-return" onClick={()=>setKeyBrowserOpen(false)}>{tr('panels.pluginCfg.backToConn')}</button><WebView url="https://console.typesafe.ai/" selected/></div>:unlockFor&&vaultStatus?<div className="pm-vault-unlock"><p className="pm-settings-intro">{tr('panels.pluginCfg.unlockThen',{what:unlockFor.action==='save'?tr('panels.pluginCfg.whatSave'):unlockFor.action==='test'?tr('panels.pluginCfg.whatTest'):tr('panels.pluginCfg.whatPrev')})}</p><VaultGate status={vaultStatus} onUnlocked={()=>{const next=unlockFor;setUnlockFor(null);setVaultStatus(null);if(next)void run(next.action,next.field)}}/><button type="button" onClick={()=>{setUnlockFor(null);setVaultStatus(null)}}>{tr('panels.pluginCfg.backToSettings')}</button></div>:<form autoComplete="off" onSubmit={e=>{e.preventDefault();void run('save')}}>
   <p className="pm-settings-intro">{tr('panels.pluginCfg.intro',{purpose})}</p>
   {plugin.config?.fields.map(field=><div key={field.id} className="pm-config-row"><label className="pm-config-field">
    <span>{field.label}{field.required?tr('panels.pluginCfg.required'):''} · {configured===null?tr('panels.pluginCfg.unknown'):configured.includes(field.id)?field.type==='directory'?tr('panels.pluginCfg.dirSaved'):tr('panels.pluginCfg.keepBlank'):tr('panels.pluginCfg.notSet')}</span>
    <span className="pm-cd">{field.purpose}</span>
    {field.type==='directory'?<span className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>void run('directory',field.id)}>{field.access==='read'?tr('panels.pluginCfg.chooseDirRead'):tr('panels.pluginCfg.chooseDirWrite')}</button></span>:field.type==='enum'?<select disabled={busy} value={draft[field.id]??''} onChange={e=>setDraft(d=>({...d,[field.id]:e.target.value}))}><option value="" disabled>{tr('panels.pluginCfg.chooseOption')}</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input disabled={busy} autoComplete="off" type={field.type==='secret'?'password':'text'} maxLength={field.type==='string'?field.maxLength:16384} value={draft[field.id]??''} onChange={e=>setDraft(d=>{const n={...d};if(e.target.value)n[field.id]=e.target.value;else delete n[field.id];return n})}/>}
    {!field.required&&field.type!=='directory'&&<button type="button" disabled={busy} onClick={()=>setDraft(d=>({...d,[field.id]:null}))}>{draft[field.id]===null?tr('panels.pluginCfg.clearOnSave'):tr('panels.pluginCfg.clearField')}</button>}
   </label>{plugin.id==='eas:jev'&&field.id==='api-key'&&<button type="button" disabled={busy} className="pm-key-help" onClick={()=>setKeyBrowserOpen(true)} aria-label={tr('panels.pluginCfg.getKeyAria')}>{tr('panels.pluginCfg.getKey')}</button>}</div>)}
   <div className="pm-auth-actions pm-settings-primary">{plugin.config?.fields.some(f=>f.type!=='directory')&&<button className="pm-settings-save" type="submit" disabled={busy||!Object.keys(draft).length}>{tr('panels.pluginCfg.saveConfig')}</button>}{plugin.config?.startup!=='deferred'&&<button type="button" disabled={busy||!!Object.keys(draft).length} onClick={()=>void run('test')}>{tr('panels.pluginAccount.test')}</button>}<button type="button" disabled={busy} onClick={()=>void run('status')}>{tr('panels.pluginCfg.refreshStatus')}</button></div>
   {plugin.config?.startup==='deferred'&&<p className="pm-cd">{tr('panels.pluginCfg.deferredNote')}</p>}
   {message.includes(LOCK_MARK)&&<p className="pm-cd">{tr('panels.pluginCfg.lockNote')}</p>}
   <div className="pm-cd" role="status">{busy?tr('panels.pluginCfg.busy'):message}</div>
   <div className="pm-settings-danger"><p>{tr('panels.pluginCfg.disconnectNote')}</p><div className="pm-auth-actions"><button type="button" disabled={busy} onClick={()=>void run('clear')}>{tr('panels.pluginCfg.disconnectClear')}</button></div></div>
  </form>}</PluginSettingsDialog>}
 </div>
}
