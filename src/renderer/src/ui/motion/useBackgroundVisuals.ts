import { useEffect } from 'react'
import './backgroundVisuals.css'
/** 只暂停视觉层；不暂停 IPC、PTY、网络任务、审批或持久化。 */
export function useBackgroundVisuals(): void {
 useEffect(()=>{
  const update=():void=>{
   document.documentElement.toggleAttribute('data-visual-paused',document.hidden||!document.hasFocus())
  }
  update()
  document.addEventListener('visibilitychange',update)
  window.addEventListener('blur',update)
  window.addEventListener('focus',update)
  return ()=>{
   document.removeEventListener('visibilitychange',update)
   window.removeEventListener('blur',update)
   window.removeEventListener('focus',update)
   document.documentElement.removeAttribute('data-visual-paused')
  }
 },[])
}
