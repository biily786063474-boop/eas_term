import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {RuntimeMonitorPanel} from './RuntimeMonitorPanel'
import {runtimeCounts} from '../../../../shared/runtimeCounts'
import type {RuntimeMonitorSnapshot} from '../../../../shared/runtimeResources'
import './runtimeCenter.css'

function RuntimeDialog({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null
  dialog.current?.showModal()
  return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[])
 return createPortal(<dialog ref={dialog} className="runtime-center-dialog cset-box" aria-label="运行中心"
  onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="runtime-center-content" onClick={e=>e.stopPropagation()}>
   <header className="cset-head"><span className="cset-title">运行中心</span><button autoFocus className="cset-close" aria-label="关闭运行中心" onClick={onClose}>✕</button></header>
   <div className="runtime-center-scroll"><RuntimeMonitorPanel/></div>
  </div>
 </dialog>,document.body)
}

/** Header reads the same main-owned cached sample, never starts a second sampler. */
export function RuntimeCenter(){
 const [open,setOpen]=useState(false),[sample,setSample]=useState<RuntimeMonitorSnapshot|null>(null)
 useEffect(()=>{
  let alive=true,pending=false,timer:ReturnType<typeof setTimeout>|undefined
  const read=async()=>{
   timer=undefined
   if(!alive||document.hidden||pending)return
   pending=true
   try{const next=await window.api.runtimeMonitor();if(alive)setSample(next)}catch{if(alive)setSample(null)}
   finally{pending=false;if(alive&&!document.hidden)timer=setTimeout(read,3000)}
  }
  const visibility=()=>{if(timer){clearTimeout(timer);timer=undefined}if(!document.hidden)void read()}
  document.addEventListener('visibilitychange',visibility);void read()
  return()=>{alive=false;if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visibility)}
 },[])
 const counts=runtimeCounts(sample)
 return <><button className="tb-item runtime-center-trigger" aria-label="打开运行中心" aria-haspopup="dialog" aria-expanded={open}
  data-tip="运行服务与等待队列" onMouseDown={e=>e.stopPropagation()} onClick={()=>setOpen(true)}>
  运行 {counts.services??'—'}{counts.waiting?` · 等待 ${counts.waiting}`:''}
 </button>{open&&<RuntimeDialog onClose={()=>setOpen(false)}/>}</>
}
