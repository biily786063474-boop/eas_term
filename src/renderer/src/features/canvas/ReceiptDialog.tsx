import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { receiptPng, receiptSvg, type ReceiptContent } from './receiptReport'
import './usageReceipt.css'

export function ReceiptDialog({title,load,initialContent,privacy='分享内容包含项目名称，不包含路径或对话。',onClose}:{title:string;load?:()=>Promise<ReceiptContent>;initialContent?:ReceiptContent;privacy?:string;onClose:()=>void}):JSX.Element {
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
  void receiptPng(svg).then(value=>{if(live)setPng(value)}).catch(e=>{if(live)setError('图片生成失败：'+String(e))})
  // Reduced-motion users get the same content immediately, without paper movement.
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)setPrinted(true)
  return ()=>{live=false}
 },[svg])
 const perform=async(action:'copy'|'save'|'text'):Promise<void>=>{
  setBusy(true);setStatus('')
  try {
   if(action==='text'){await window.api.clipboard.writeText(content!.text);setStatus('已复制文字')}
   else {
    const result=await window.api.usage.receipt(action,png)
    if(result.cancelled)setStatus('已取消保存')
    else if(!result.ok)throw new Error(result.error||'操作失败')
    else setStatus(action==='copy'?'已复制图片，可粘贴分享':'已保存图片')
   }
  }catch(e){setStatus('操作失败：'+String(e))}
  finally{setBusy(false)}
 }
 return createPortal(<dialog ref={dialog} className="ur-dialog" aria-labelledby="ur-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="ur-header"><div><span>YOUR WORK, IN PRINT</span><h3 id="ur-title">{title}</h3></div><button className="ur-close" onClick={onClose} aria-label="关闭小票">×</button></div>
  <div className="ur-scroll">
   <div className="ur-printer" aria-hidden="true"><span>EAS / PRINT</span><i/><div className="ur-slot"/></div>
   {error?<div className="ur-message" role="alert">{error}{!content&&<button onClick={()=>setRetry(v=>v+1)}>重试</button>}</div>:!content?<p className="ur-message" role="status">正在汇总本地记录…</p>:<div className="ur-paper-window"><div className="ur-paper-curve"><img className="ur-paper" src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)} alt={content.text} onAnimationEnd={()=>setPrinted(true)}/></div></div>}
  </div>
  <div className="ur-footer"><div className="ur-actions"><button data-receipt-action="copy" disabled={!printed||!png||busy} onClick={()=>void perform('copy')}>复制图片</button><button data-receipt-action="save" disabled={!printed||!png||busy} onClick={()=>void perform('save')}>保存图片</button><button data-receipt-action="text" disabled={!printed||!content||busy} onClick={()=>void perform('text')}>复制文字</button></div><p className="ur-status" role="status">{status||(content?(printed?privacy:'正在打印你这一期的投入…'):'数据不离开本机，不消耗 AI Token。')}</p></div>
 </dialog>,document.body)
}
