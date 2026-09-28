import { useEffect, useRef, useState, useId } from 'react'
import { useStore } from '../../store'
import { createPortal } from 'react-dom'
import { safeChatImages,chatImageName,type ChatImage } from '../../../../shared/chatImages'
import {createVisibleImage,type ImageLoadState} from './imageLoading'

type ReadResult={ok:boolean;url?:string;error?:string}
let decoding=0
const pending:(()=>void)[]=[]
const read=async(im:ChatImage,original=false,active=()=>true):Promise<ReadResult>=>{
 if(decoding>=2)await new Promise<void>(resolve=>pending.push(resolve))
 else decoding++
 try{
  if(!active())return {ok:false}

  const r=chatImageName(im)?await window.api.chatImages.read(im,original):{ok:true,url:im.url}
  if(!r.ok||!r.url||original)return r
  const payload=atob(r.url.slice(r.url.indexOf(',')+1))
  const bytes=Uint8Array.from(payload,c=>c.charCodeAt(0))
  const blob=new Blob([bytes],{type:im.mimeType})
  const bitmap=await createImageBitmap(blob)
  try{
   const ratio=Math.min(1,384/Math.max(bitmap.width,bitmap.height))
   const canvas=document.createElement('canvas')
   canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio))
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建预览')
   ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
   const url=canvas.toDataURL('image/png');canvas.width=canvas.height=0
   return {ok:true,url}
  }finally{bitmap.close()}
 }catch{return {ok:false,error:'图片无法解码，可恢复已有原文件'}}
 finally{const next=pending.shift();if(next)next();else decoding--}
}
function LazyImage({image,index,onOpen}:{image:ChatImage;index:number;onOpen:()=>void}):JSX.Element{
 const root=useRef<HTMLDivElement>(null)
 const [state,setState]=useState<ImageLoadState>({})
 const loader=useRef<ReturnType<typeof createVisibleImage>>()
 const [restoring,setRestoring]=useState(false)
 useEffect(()=>{
  const el=root.current
  if(!el)return
  let alive=true
  const controller=createVisibleImage(active=>read(image,false,active),v=>{if(alive)setState(v)})
  loader.current=controller
  const observer=new IntersectionObserver(entries=>controller.visible(entries.some(e=>e.isIntersecting)),{threshold:0})
  observer.observe(el)
  return()=>{alive=false;observer.disconnect();controller.dispose();loader.current=undefined}
 },[image.url,image.mimeType])
 const restore=async()=>{
  setRestoring(true)
  try{const r=await window.api.chatImages.restore(image);if(r.ok)loader.current?.retry();else if(!r.cancelled)setState({error:r.error??'恢复失败'})}
  catch{setState({error:'恢复失败，请重试'})}
  finally{setRestoring(false)}
 }
 return <div className="ac-returned-image-cell" ref={root}>
  {state.error?<div className="ac-returned-image-error" role="status">
   <span>{state.error}</span>
   <div className="ac-image-actions">
    <button type="button" onClick={()=>loader.current?.retry()}>重试读取</button>
    {chatImageName(image)&&<button type="button" disabled={restoring} onClick={()=>void restore()}>{restoring?'恢复中…':'恢复原文件'}</button>}
   </div>
  </div>:<button type="button" aria-label={'放大返回图片 '+(index+1)} disabled={!state.url} onClick={onOpen}>
   {state.url?<img src={state.url} alt={'返回图片 '+(index+1)} onError={()=>setState({error:'图片无法解码，可尝试恢复原文件'})}/>:<span className="ac-image-placeholder">图片 · 按需加载</span>}
  </button>}
 </div>
}
/** Main signs content references. Pixels exist only in visible thumbnails or the open modal. */
export function ReturnedImages({images}:{images:unknown}):JSX.Element|null{
 const safe=safeChatImages(images)
 const [preview,setPreview]=useState<ChatImage|null>(null)
 const [full,setFull]=useState<ImageLoadState>({})
 const dialog=useRef<HTMLDialogElement>(null)
 const overlayId=useId()
 useEffect(()=>{
  if(!preview){setFull({});return}
  let alive=true
  setFull({})
  void read(preview,true).then(r=>{if(alive)setFull(r.ok?{url:r.url}:{error:r.error})},()=>{if(alive)setFull({error:'原图读取失败'})})
  const owner='chat-image-'+overlayId
  const previous=useStore.getState().fullscreenOverlay==='live-page'?null:useStore.getState().fullscreenOverlay
  useStore.getState().setFullscreenOverlay(owner)
  if(dialog.current&&!dialog.current.open)dialog.current.showModal()
  return()=>{alive=false;if(useStore.getState().fullscreenOverlay===owner)useStore.getState().setFullscreenOverlay(previous)}
 },[preview,overlayId])
 if(!safe.length)return null
 return <>
  <div className="ac-returned-images" aria-label="AI 返回的图片">
   {safe.map((im,i)=><LazyImage key={im.url} image={im} index={i} onOpen={()=>setPreview(im)}/>)}
  </div>
  {preview&&createPortal(<dialog ref={dialog} className="ac-image-preview" aria-label="返回图片预览"
    onCancel={e=>{e.preventDefault();setPreview(null)}}
    onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();setPreview(null)}}}
    onMouseDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}
    onClick={e=>{if(e.target===e.currentTarget)setPreview(null)}}>
    <button type="button" autoFocus aria-label="关闭图片预览" onClick={()=>setPreview(null)}>关闭</button>
    {full.error?<p role="status">{full.error}</p>:full.url?<img src={full.url} alt="返回图片原图" onError={()=>setFull({error:'原图无法解码'})}/>:<p>正在读取本地原图…</p>}
  </dialog>,document.body)}
 </>
}
export function ReturnedImageNotice({notices}:{notices:string[]}):JSX.Element|null{
 const [folderError,setFolderError]=useState('')
 if(!notices.length)return null
 const distinct=[...new Set(notices)]
 return <details className="ac-image-notice">
  <summary>图片提示 · {notices.length} 条记录需要处理</summary>
  <p>已保存的原图仍可打开；以下情况不会触发模型重新生成。</p>
  {distinct.map(text=><p key={text}>{text}</p>)}
  <button type="button" onClick={()=>{void window.api.chatImages.folder().then(r=>setFolderError(r.ok?'':r.error??'无法打开目录')).catch(()=>setFolderError('无法打开目录'))}}>查看图片目录</button>
  {folderError&&<span role="status">{folderError}</span>}
 </details>
}
