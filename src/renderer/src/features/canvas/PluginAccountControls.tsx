import {useEffect,useRef,useState} from 'react'
import {PluginSettingsDialog} from './PluginSettingsDialog'
import {pluginAuthorizationLabel,type PluginAuthorizationAction,type PluginAuthorizationStatus} from '../../../../shared/pluginAuthorization'
/** No timers/decryption polling. Refresh explicitly; credentials never cross this boundary. */
function PluginAccountForm({id,enabled}:{id:string;enabled:boolean}):JSX.Element {
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
  }catch{if(seq===generation.current)setError('账号状态读取失败，请重试')}
  finally{if(seq===generation.current)setBusy(false)}
 }
 useEffect(()=>{void run('status');return()=>{generation.current++}},[id])
 return <div className="pm-auth" data-plugin-account={id}>
  <div className="pm-cd" role="status">{busy?'账号操作中…':status?pluginAuthorizationLabel(status):'读取账号状态…'}</div>
  {connection&&<div className="pm-cd" role="status">已连通 · {connection.toolCount} 个工具 · {new Date(connection.checkedAt).toLocaleTimeString()} 检测（未执行业务操作）</div>}
  {error&&<div className="pm-cd" role="alert">{error}</div>}
  <div className="pm-auth-actions">
   <button type="button" disabled={busy||!enabled} onClick={()=>void run('login')}>{status==='authorized'?'重新授权':'连接账号'}</button>
   <button type="button" disabled={busy} onClick={()=>void run('status')}>刷新状态</button>
   <button type="button" disabled={busy||!enabled} onClick={()=>void run('test')}>测试连接</button>
  </div>
  <div className="pm-settings-danger"><p>断开会清除本机授权并关闭连接，不等于撤销服务商授权或已执行的操作。</p><div className="pm-auth-actions"><button type="button" onClick={()=>void run('disconnect')}>断开</button></div></div>
 </div>
}
export function PluginAccountControls({id,enabled,title='账号与连接'}:{id:string;enabled:boolean;title?:string}):JSX.Element{
 const [open,setOpen]=useState(false)
 const trigger=useRef<HTMLButtonElement>(null)
 return <div className="pm-auth"><div className="pm-auth-actions"><button ref={trigger} type="button" data-plugin-account-trigger={id} onClick={()=>setOpen(true)}>账号与连接</button></div>{open&&<PluginSettingsDialog returnFocus={trigger} title={title} onClose={()=>setOpen(false)}><p className="pm-settings-intro">由你在浏览器授权，不读取其他 CLI 的账号凭证。</p><PluginAccountForm id={id} enabled={enabled}/></PluginSettingsDialog>}</div>
}
