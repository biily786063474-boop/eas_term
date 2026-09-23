import { useEffect, useState } from 'react'
import { CliSetupPanel } from '../agentChat/CliSetupPanel'
import type { CliAuthState, InstallPlan, InstallState } from '../../../../shared/types'

type Kind = 'claude'|'codex'
export function AiAssistantsSettings():React.JSX.Element {
 const [plan,setPlan]=useState<InstallPlan|null>(null)
 const [auth,setAuth]=useState<Partial<Record<Kind,CliAuthState>>>({})
 const [tasks,setTasks]=useState<Partial<Record<Kind,InstallState|null>>>({})
 const [error,setError]=useState('')
 const [picked,setPicked]=useState<Kind|null>(null)
 const refresh=():void=>{for(const id of ['claude','codex'] as const)void window.api.cliAuth.check(id).then(s=>setAuth(old=>({...old,[id]:s}))).catch(()=>setError('无法读取助手状态，请重试'))}
 useEffect(()=>{
  let active=true
  void window.api.skill.installPlan().then(p=>{if(active)setPlan(p)}).catch(()=>{if(active)setError('无法读取安装方案，请重新打开设置')})
  for(const id of ['claude','codex'] as const){
   void window.api.cliAuth.check(id).then(s=>{if(active)setAuth(old=>({...old,[id]:s}))}).catch(()=>{if(active)setError('无法读取助手状态，请重试')})
   void window.api.cliAuth.installSnapshot(id).then(s=>{if(active)setTasks(old=>({...old,[id]:s}))}).catch(()=>{})
  }
  const off=window.api.cliAuth.onInstall(s=>{setTasks(old=>({...old,[s.cli]:s}));if(s.phase==='done')refresh()})
  return ()=>{active=false;off()}
 },[])
 return <div>
 {error&&<p role="alert" className="ac-login-err">{error}<button onClick={()=>{setError('');refresh()}}>重新检测</button></p>}
 {(['claude','codex'] as const).map(id=>{
 const st=auth[id],t=tasks[id],running=t&&['running','verifying','stopping'].includes(t.phase)
 const label=running?'安装中':t?.phase==='failed'?'安装未完成':t?.phase==='canceled'?'已取消':!st?'检测中':!st.installed?'未安装':st.status?.loggedIn?'已就绪':st.status?'待登录':'登录状态未知'
 const action=running?'查看进度':t?.phase==='failed'?'查看问题 / 重试':label==='已就绪'?'重新检测':st?.installed?'登录':'安装'
 return <div className="ac-assistant-row" key={id}><div><strong>{id==='claude'?'Claude Code':'Codex'}</strong><span>{label}</span></div><button className="ac-login-retry" disabled={!plan||!st} onClick={()=>label==='已就绪'?refresh():setPicked(id)}>{action}</button></div>
 })}
 <p className="cset-note">跳过首次引导后，也可以随时在这里安装或登录。安装不会自动发送对话草稿。</p>
 {picked&&plan&&<CliSetupPanel cliId={picked} displayName={plan[picked].name} installCmd={plan[picked].options[0]?.cmd} from={auth[picked]?.installed?'login':'install'} onCancel={()=>setPicked(null)} onDone={()=>{setPicked(null);refresh()}}/>}
 </div>
}
