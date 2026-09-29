import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { popupPosition } from './composerCandidates'
import { useT } from '../../i18n.ts'

/** Tracks the canvas anchor only while visible; closing keeps one short exit transition. */
export function ComposerPopover({open, anchor, onClose, title, children}: {
 open:boolean; anchor:RefObject<HTMLButtonElement>; onClose:()=>void; title:string; children:ReactNode
}):JSX.Element|null {
 const t=useT()
 const [present,setPresent]=useState(open), [active,setActive]=useState(false)
 const [position,setPosition]=useState<ReturnType<typeof popupPosition>>(null)
 const panel=useRef<HTMLDivElement>(null)
 const focused=useRef(false)
 const close=useRef(onClose); close.current=onClose
 useEffect(()=>{
  if(open){setPresent(true);const f=requestAnimationFrame(()=>setActive(true));return()=>cancelAnimationFrame(f)}
  setActive(false)
  const t=setTimeout(()=>setPresent(false),180);return()=>clearTimeout(t)
 },[open])
 useLayoutEffect(()=>{if(panel.current)panel.current.inert=!open},[open,present])
 useLayoutEffect(()=>{
  if(!present)return
  let f=0,last=''
  const update=()=>{
   const r=anchor.current?.getBoundingClientRect()
   const p=r?popupPosition(r,innerWidth,innerHeight):null
   const key=JSON.stringify(p)
   if(last!==key){last=key;setPosition(p)}
   f=requestAnimationFrame(update)
  }; update();return()=>cancelAnimationFrame(f)
 },[present,anchor])
 useEffect(()=>{
  if(!open){focused.current=false;return}
  if(position && panel.current && !focused.current){panel.current.focus();focused.current=true}
 },[open,position])
 useEffect(()=>{
  if(!open)return
  const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))close.current()}
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();anchor.current?.focus();close.current()}}
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true)
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true)}
 },[open,anchor])
 if(!present||!position)return null
 return createPortal(<div ref={panel} className="ac-composer-popover" data-open={active&&open} style={position} role="dialog" tabIndex={-1} aria-label={title} aria-hidden={!open}>
  <div className="ac-send-preview-head"><strong>{title}</strong><button type="button" aria-label={t('chat.popover.close',{title})} onClick={()=>{anchor.current?.focus();onClose()}}>×</button></div>{children}
 </div>,document.body)
}
