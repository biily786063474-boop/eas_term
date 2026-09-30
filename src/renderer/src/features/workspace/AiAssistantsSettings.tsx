import { useEffect, useState } from 'react'
import { useT } from '../../i18n.ts'
import { CliSetupPanel } from '../agentChat/CliSetupPanel'
import type { CliAuthState, InstallPlan, InstallState } from '../../../../shared/types'

type Kind = 'claude'|'codex'
export function AiAssistantsSettings():React.JSX.Element {
 const tr=useT()
 const [plan,setPlan]=useState<InstallPlan|null>(null)
 const [auth,setAuth]=useState<Partial<Record<Kind,CliAuthState>>>({})
 const [tasks,setTasks]=useState<Partial<Record<Kind,InstallState|null>>>({})
 const [error,setError]=useState('')
 const [picked,setPicked]=useState<Kind|null>(null)
 const refresh=():void=>{for(const id of ['claude','codex'] as const)void window.api.cliAuth.check(id).then(s=>setAuth(old=>({...old,[id]:s}))).catch(()=>setError(tr('settings.assistants.errStatus')))}
 useEffect(()=>{
  let active=true
  void window.api.skill.installPlan().then(p=>{if(active)setPlan(p)}).catch(()=>{if(active)setError(tr('settings.assistants.errPlan'))})
  for(const id of ['claude','codex'] as const){
   void window.api.cliAuth.check(id).then(s=>{if(active)setAuth(old=>({...old,[id]:s}))}).catch(()=>{if(active)setError(tr('settings.assistants.errStatus'))})
   void window.api.cliAuth.installSnapshot(id).then(s=>{if(active)setTasks(old=>({...old,[id]:s}))}).catch(()=>{})
  }
  const off=window.api.cliAuth.onInstall(s=>{setTasks(old=>({...old,[s.cli]:s}));if(s.phase==='done')refresh()})
  return ()=>{active=false;off()}
 },[])
 return <div>
 {error&&<p role="alert" className="ac-login-err">{error}<button onClick={()=>{setError('');refresh()}}>{tr('settings.assistants.recheck')}</button></p>}
 {(['claude','codex'] as const).map(id=>{
 const st=auth[id],t=tasks[id],running=t&&['running','verifying','stopping'].includes(t.phase)
 const isReady=!running&&t?.phase!=='failed'&&t?.phase!=='canceled'&&!!st&&st.installed&&!!st.status?.loggedIn
 const label=running?tr('settings.assistants.installing'):t?.phase==='failed'?tr('settings.assistants.installFailed'):t?.phase==='canceled'?tr('settings.assistants.canceled'):!st?tr('settings.assistants.detecting'):!st.installed?tr('settings.assistants.notInstalled'):st.status?.loggedIn?tr('settings.assistants.ready'):st.status?tr('settings.assistants.needLogin'):tr('settings.assistants.loginUnknown')
 const action=running?tr('settings.assistants.viewProgress'):t?.phase==='failed'?tr('settings.assistants.viewIssue'):isReady?tr('settings.assistants.recheck'):st?.installed?tr('settings.assistants.login'):tr('settings.assistants.install')
 return <div className="ac-assistant-row" key={id}><div><strong>{id==='claude'?'Claude Code':'Codex'}</strong><span>{label}</span></div><button className="ac-login-retry" disabled={!plan||!st} onClick={()=>isReady?refresh():setPicked(id)}>{action}</button></div>
 })}
 <p className="cset-note">{tr('settings.assistants.note')}</p>
 {picked&&plan&&<CliSetupPanel cliId={picked} displayName={plan[picked].name} installCmd={plan[picked].options[0]?.cmd} from={auth[picked]?.installed?'login':'install'} onCancel={()=>setPicked(null)} onDone={()=>{setPicked(null);refresh()}}/>}
 </div>
}
