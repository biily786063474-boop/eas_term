import {useEffect,useId,useRef,type ReactNode,type RefObject} from 'react'
/** Native top layer keeps the marketplace grid compact and traps/restores keyboard focus. */
export function PluginSettingsDialog({title,busy=false,onClose,children,returnFocus}:{title:string;busy?:boolean;onClose:()=>void;children:ReactNode;returnFocus:RefObject<HTMLButtonElement>}):JSX.Element{
 const ref=useRef<HTMLDialogElement>(null),titleId=useId()
 useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>{dialog.close();queueMicrotask(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true})})}},[returnFocus])
 return <dialog ref={ref} className="pm-settings" aria-labelledby={titleId} onKeyDown={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
  <header className="pm-settings-head"><div><div className="pm-settings-eyebrow">插件设置</div><h2 id={titleId}>{title}</h2></div><button type="button" className="pm-settings-close" aria-label="关闭插件设置" disabled={busy} onClick={onClose}>×</button></header>
  <div className="pm-settings-body">{children}</div>
 </dialog>
}
