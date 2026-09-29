import {PluginSettingsIcon} from "./PluginSettingsIcon"

import {useEffect,useRef,useState} from 'react'
import {PluginSettingsDialog} from './PluginSettingsDialog'
import {useT} from '../../i18n.ts'
import {pluginAuthorizationLabel,type PluginAuthorizationAction,type PluginAuthorizationStatus} from '../../../../shared/pluginAuthorization'
/** No timers/decryption polling. Refresh explicitly; credentials never cross this boundary. */
function PluginAccountForm({id,enabled}:{id:string;enabled:boolean}):JSX.Element {
 const tr=useT()
 const [status,setStatus]=useState<PluginAuthorizationStatus|null>(null)
 const [connection,setConnection]=useState<{toolCount:number;checkedAt:number}|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState<string|null>(null)
 const generation=useRef(0)
 const run=async(action:PluginAuthorizationAction)=>{
  const seq=++generation.current;setBusy(true);setError(null);setConnection(null)
  try{
   const result=await window.api.plugins.authorization(action,id)
   if(seq!==generation.current)return
   if(result.ok){setStatus(result.status);setConnection(result.connection??null)}
   else setError(result.error)
  }catch{if(seq===generation.current)setError(tr('panels.pluginAccount.readFail'))}
  finally{if(seq===generation.current)setBusy(false)}
 }
 useEffect(()=>{void run('status');return()=>{generation.current++}},[id])
 return <div className="pm-auth" data-plugin-account={id}>
  <div className="pm-cd" role="status">{busy?tr('panels.pluginAccount.busy'):status?(connection&&status==='authorized'?tr('panels.pluginAccount.saved'):pluginAuthorizationLabel(status)):tr('panels.pluginAccount.reading')}</div>
  {connection&&<div className="pm-cd" role="status">{tr('panels.pluginAccount.connected',{n:connection.toolCount,time:new Date(connection.checkedAt).toLocaleTimeString()})}</div>}
  {error&&<div className="pm-cd" role="alert">{error}</div>}
  <div className="pm-auth-actions">
   <button type="button" disabled={busy||!enabled} onClick={()=>void run('login')}>{status==='authorized'?tr('panels.pluginAccount.reauth'):tr('panels.pluginAccount.connect')}</button>
   <button type="button" disabled={busy} onClick={()=>void run('status')}>{tr('panels.pluginAccount.refresh')}</button>
   <button type="button" disabled={busy||!enabled} onClick={()=>void run('test')}>{tr('panels.pluginAccount.test')}</button>
  </div>
  <div className="pm-settings-danger"><p>{tr('panels.pluginAccount.disconnectNote')}</p><div className="pm-auth-actions"><button type="button" onClick={()=>void run('disconnect')}>{tr('panels.pluginAccount.disconnect')}</button></div></div>
 </div>
}
export function PluginAccountControls({id,enabled,title}:{id:string;enabled:boolean;title?:string}):JSX.Element{
 const tr=useT()
 const [open,setOpen]=useState(false)
 const trigger=useRef<HTMLButtonElement>(null)
 return <div className="pm-card-settings"><div className="pm-setting-entry"><button className="pm-settings-trigger" ref={trigger} type="button" title={tr('panels.pluginAccount.tip')} aria-label={tr('panels.pluginAccount.triggerAria')} data-plugin-account-trigger={id} onClick={()=>setOpen(true)}><PluginSettingsIcon/><span>{tr('panels.pluginAccount.connect')}</span></button><span className="pm-setting-tip" role="tooltip">{tr('panels.pluginAccount.tip')}</span></div>{open&&<PluginSettingsDialog returnFocus={trigger} title={title??tr('panels.pluginAccount.title')} onClose={()=>setOpen(false)}><p className="pm-settings-intro">{tr('panels.pluginAccount.intro')}</p><PluginAccountForm id={id} enabled={enabled}/></PluginSettingsDialog>}</div>
}
