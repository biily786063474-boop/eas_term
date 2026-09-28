import {chatImageName,safeChatImages,type ChatImage} from '../shared/chatImages.ts'
import type {createChatImageStore} from './chatImageStore.ts'
/** Only returned-image fields; keep user attachments and stable message sequences. */
export function persistHistoryImages(turns:unknown[],store:Pick<ReturnType<typeof createChatImageStore>,'persist'>,preserveFailed=false,previous:unknown[]=[]):unknown[] {
 const protectedInline=new Map<string,ChatImage>()
 const protect=(value:unknown)=>{
  if(!value||typeof value!=="object")return
  const v=value as Record<string,unknown>
  for(const key of ["returnedImages","images"]){
   if(key==="images"&&v.role==="user")continue
   for(const im of safeChatImages(v[key]))if(!chatImageName(im)){
    const result=store.persist([im])
    if(result.failures&&result.images[0])protectedInline.set(result.images[0].url,im)
   }
  }
  if(Array.isArray(v.execs))v.execs.forEach(protect)
 }
 if(preserveFailed)previous.forEach(protect)
 const owner=(value:unknown):unknown=>{
  if(!value||typeof value!=='object')return value
  const v=value as Record<string,unknown>,out={...v}
  for(const key of ['returnedImages','images']){
   const list=v[key]
   if(!Array.isArray(list))continue
   if(key==='images'&&(v.role==='user'||list.some(x=>x?.path)))continue
   const recoverable=list.map(im=>protectedInline.get(im?.url)??im)
   const result=store.persist(recoverable)
   out[key]=preserveFailed&&result.failures?recoverable:result.images
   if(result.failures)out.imageNotice='有 '+result.failures+' 张图片未能保存：'+result.reasons.join('；')+'。检查磁盘空间/权限后重试，或从已有原文件恢复。'
  }
  if(Array.isArray(v.execs))out.execs=v.execs.map(owner)
  return out
 }
 return turns.map(owner)
}

/** Avoid serializing/copying multi-MiB history on every subsequent load. */
export function hasInlineReturnedImages(turns:unknown[]):boolean {
 return turns.some(value=>{
  if(!value||typeof value!=='object')return false
  const v=value as Record<string,unknown>
  return ['returnedImages','images'].some(key=>!(key==='images'&&v.role==='user')&&Array.isArray(v[key])&&(v[key] as unknown[]).some(im=>!!im&&typeof im==='object'&&typeof (im as ChatImage).url==='string'&&(im as ChatImage).url.startsWith('data:')))||Array.isArray(v.execs)&&hasInlineReturnedImages(v.execs)
 })
}
