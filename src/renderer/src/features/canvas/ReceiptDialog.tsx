import { useT } from '../../i18n.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { receiptPng, receiptSvg, type ReceiptContent } from './receiptReport'
import './usageReceipt.css'

export function ReceiptDialog({title,load,initialContent,privacy,onClose}:{title:string;load?:()=>Promise<ReceiptContent>;initialContent?:ReceiptContent;privacy?:string;onClose:()=>void}):JSX.Element {
  const tr = useT()
 const dialog=useRef<HTMLDialogElement>(null)
 const [content,setContent]=useState<ReceiptContent|null>(initialContent??null)
 const [error,setError]=useState(''),[status,setStatus]=useState(''),[retry,setRetry]=useState(0)
 const [printed,setPrinted]=useState(false),[busy,setBusy]=useState(false),[png,setPng]=useState('')
 const svg=useMemo(()=>content?receiptSvg(content):'',[content])
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null
  dialog.current?.showModal()
  return ()=>{dialog.current?.close();previous?.focus()}
 },[])
 useEffect(()=>{
  if(!load)return
  let live=true;setError('')
  void load().then(value=>{if(live)setContent(value)}).catch(e=>{if(live)setError(String(e))})
  return ()=>{live=false}
 },[load,retry])
 useEffect(()=>{
  if(!svg)return
  let live=true
  void receiptPng(svg).then(value=>{if(live)setPng(value)}).catch(e=>{if(live)setError(tr('canvas.receipt.pngFailed',{err:String(e)}))})
  // Reduced-motion users get the same content immediately, without paper movement.
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)setPrinted(true)
  return ()=>{live=false}
 },[svg])
 const perform=async(action:'copy'|'save'|'text'):Promise<void>=>{
  setBusy(true);setStatus('')
  try {
   if(action==='text'){await window.api.clipboard.writeText(content!.text);setStatus(tr('canvas.receipt.copiedText'))}
   else {
    const result=await window.api.usage.receipt(action,png)
    if(result.cancelled)setStatus(tr('canvas.receipt.saveCancelled'))
    else if(!result.ok)throw new Error(result.error||tr('canvas.receipt.actionFailedShort'))
    else setStatus(action==='copy'?tr('canvas.receipt.copiedImage'):tr('canvas.receipt.savedImage'))
   }
  }catch(e){setStatus(tr('canvas.receipt.actionFailed',{err:String(e)}))}
  finally{setBusy(false)}
 }
 return createPortal(<dialog ref={dialog} className="ur-dialog" aria-labelledby="ur-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="ur-header"><div><span>YOUR WORK, IN PRINT</span><h3 id="ur-title">{title}</h3></div><button className="ur-close" onClick={onClose} aria-label={tr('canvas.receipt.close')}>×</button></div>
  <div className="ur-scroll">
   <div className="ur-printer" aria-hidden="true"><span>EAS / PRINT</span><i/><div className="ur-slot"/></div>
   {error?<div className="ur-message" role="alert">{error}{!content&&<button onClick={()=>setRetry(v=>v+1)}>{tr('canvas.receipt.retry')}</button>}</div>:!content?<p className="ur-message" role="status">{tr('canvas.receipt.summarizing')}</p>:<div className="ur-paper-window"><div className="ur-paper-curve"><img className="ur-paper" src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)} alt={content.text} onAnimationEnd={()=>setPrinted(true)}/></div></div>}
  </div>
  <div className="ur-footer"><div className="ur-actions"><button data-receipt-action="copy" disabled={!printed||!png||busy} onClick={()=>void perform('copy')}>{tr('canvas.receipt.copyImage')}</button><button data-receipt-action="save" disabled={!printed||!png||busy} onClick={()=>void perform('save')}>{tr('canvas.receipt.saveImage')}</button><button data-receipt-action="text" disabled={!printed||!content||busy} onClick={()=>void perform('text')}>{tr('canvas.receipt.copyText')}</button></div><p className="ur-status" role="status">{status||(content?(printed?(privacy??tr('canvas.receipt.privacy')):tr('canvas.receipt.printing')):tr('canvas.receipt.localOnly'))}</p></div>
 </dialog>,document.body)
}
