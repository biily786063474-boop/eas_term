import {useEffect,useRef,useState} from 'react'
import {pluginAuthorizationLabel,type PluginAuthorizationAction,type PluginAuthorizationStatus} from '../../../../shared/pluginAuthorization'
/** No timers/decryption polling. Refresh explicitly; credentials never cross this boundary. */
export function PluginAccountControls({id,enabled}:{id:string;enabled:boolean}):JSX.Element {
 const [status,setStatus]=useState<PluginAuthorizationStatus|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState<string|null>(null)
 const generation=useRef(0)
 const run=async(action:PluginAuthorizationAction)=>{
  const seq=++generation.current;setBusy(true);setError(null)
  try{
   const result=await window.api.plugins.authorization(action,id)
   if(seq!==generation.current)return
   if(result.ok)setStatus(result.status)
   else setError(result.error)
  }catch{if(seq===generation.current)setError('账号状态读取失败，请重试')}
  finally{if(seq===generation.current)setBusy(false)}
 }
 useEffect(()=>{void run('status');return()=>{generation.current++}},[id])
 return <div className="pm-auth" data-plugin-account={id}>
  <div className="pm-cd" role="status">{busy?'账号操作中…':status?pluginAuthorizationLabel(status):'读取账号状态…'}</div>
  {error&&<div className="pm-cd" role="alert">{error}</div>}
  <div className="pm-auth-actions">
   <button type="button" disabled={busy||!enabled} onClick={()=>void run('login')}>{status==='authorized'?'重新授权':'连接账号'}</button>
   <button type="button" disabled={busy} onClick={()=>void run('status')}>刷新状态</button>
   <button type="button" onClick={()=>void run('disconnect')}>断开</button>
  </div>
 </div>
}
