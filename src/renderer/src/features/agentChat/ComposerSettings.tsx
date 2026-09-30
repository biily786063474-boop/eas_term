import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ComposerPopover } from './ComposerPopover'
import { useT } from '../../i18n.ts'
import { ChipIcon, ChevronDownIcon } from '../../ui/Icons'
export function ComposerSettings({label,children,disabled=false}:{label:string;children:ReactNode;disabled?:boolean}):JSX.Element {
 const t=useT()
 const [open,setOpen]=useState(false)
 const anchor=useRef<HTMLButtonElement>(null)
 useEffect(()=>{
  const root=anchor.current?.closest('.ac-input-wrap, .ac-composer-box')
  const reveal=()=>setOpen(true)
  root?.addEventListener('composer-settings-open',reveal)
  return()=>root?.removeEventListener('composer-settings-open',reveal)
 },[])
 useEffect(()=>{if(disabled)setOpen(false)},[disabled])
 return <><button ref={anchor} type="button" className="ac-settings-trigger" aria-label={t('chat.settings.title')} aria-expanded={open} aria-haspopup="dialog" data-tip={t('chat.settings.tip')} disabled={disabled} onClick={()=>setOpen(v=>!v)}><ChipIcon size={13}/><span>{label}</span><ChevronDownIcon size={10}/></button>
 <ComposerPopover open={open} anchor={anchor} onClose={()=>setOpen(false)} title={t('chat.settings.title')}><div className="ac-settings-content">{children}</div></ComposerPopover></>
}
