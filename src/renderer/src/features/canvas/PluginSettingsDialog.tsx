import {useT} from '../../i18n.ts'
import {useEffect,useId,useRef,type ReactNode,type RefObject} from 'react'
/** Native top layer keeps the marketplace grid compact and traps/restores keyboard focus. */
export function PluginSettingsDialog({title,wide=false,busy=false,onClose,children,returnFocus}:{title:string;wide?:boolean;busy?:boolean;onClose:()=>void;children:ReactNode;returnFocus:RefObject<HTMLButtonElement>}):JSX.Element{
 const tr=useT()
 const ref=useRef<HTMLDialogElement>(null),titleId=useId()
 useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>{dialog.close();queueMicrotask(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true})})}},[returnFocus])
 return <dialog ref={ref} className={"pm-settings"+(wide?" pm-settings-browser":"")} aria-labelledby={titleId} onKeyDown={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
  <header className="pm-settings-head"><div><div className="pm-settings-eyebrow">{tr('panels.pluginSettings.title')}</div><h2 id={titleId}>{title}</h2></div><button type="button" className="pm-settings-close" aria-label={tr('panels.pluginSettings.close')} disabled={busy} onClick={onClose}>×</button></header>
  <div className="pm-settings-body">{children}</div>
 </dialog>
}
