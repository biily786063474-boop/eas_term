import {imageDimensions} from './chatImageDimensions'
import {BrowserWindow,dialog,shell} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {guardChatImageFile} from './fsGuard'
import {guardedHandle} from './ipcGuard'
import {createChatImageStore} from './chatImageStore'
import {chatImageName,MAX_IMAGE_BYTES,type ChatImage} from '../shared/chatImages'
import type {ChatEvent} from '../shared/agentChat'
import {persistHistoryImages} from './historyImages'
import { t } from './i18n.ts'
export const chatImageStore=createChatImageStore(guardChatImageFile)
export function persistChatEventImages(e:ChatEvent):ChatEvent {
 if(e.k!=='images'&&e.k!=='exec.done')return e
 if(!e.images?.length)return e
 const result=chatImageStore.persist(e.images)
 return {...e,images:result.images,...(result.failures?{imageNotice:'有 '+result.failures+' 张图片未能保存到本机：'+result.reasons.join('；')+'。请检查磁盘空间或目录权限；不会自动重新生成。'}:{})}
}
export const migrateHistoryImages=(turns:unknown[],preserveFailed=false,previous:unknown[]=[])=>persistHistoryImages(turns,chatImageStore,preserveFailed,previous)
export function registerChatImages():void {
 guardedHandle('chatImages:read',(_e,value:unknown,_original:unknown)=>{
  const im=value as ChatImage
  try{
   if(!chatImageName(im))throw Error('图片引用无效')
   const bytes=chatImageStore.read(im)
   imageDimensions(bytes,im.mimeType)
   // Decoder lives in renderer; bounded two-at-a-time thumbnail jobs, no main-thread bitmap.
   return {ok:true,url:'data:'+im.mimeType+';base64,'+bytes.toString('base64')}
  }catch(e){
   const code=(e as NodeJS.ErrnoException).code
   return {ok:false,error:code==='ENOENT'?'本地原图不存在。可选择已有原文件恢复，不会调用模型。':code==='EACCES'?'图片目录不可读，请检查权限。':e instanceof Error?e.message:'图片读取失败'}
  }
 })
 guardedHandle('chatImages:restore',async(e,value:unknown)=>{
  const im=value as ChatImage
  if(!chatImageName(im))return {ok:false,error:'图片引用无效'}
  const window=BrowserWindow.fromWebContents(e.sender)
  if(!window)return {ok:false,error:'窗口已关闭'}
  const pick=await dialog.showOpenDialog(window,{title:t('dialogs.chatImage.pickTitle'),properties:['openFile'],filters:[{name:t('dialogs.chatImage.filter'),extensions:['png','jpg','jpeg','gif','webp']}]})
  if(pick.canceled||!pick.filePaths[0])return {ok:false,cancelled:true}
  try {
   const file=pick.filePaths[0],stat=fs.statSync(file)
   if(!stat.isFile()||stat.size>MAX_IMAGE_BYTES)throw Error('原文件超出安全大小')
   chatImageStore.restore(im,fs.readFileSync(file))
   return {ok:true}
  }catch(err){return {ok:false,error:err instanceof Error?err.message:'恢复失败'}}
 })
 guardedHandle('chatImages:folder',()=>{
  const check=guardChatImageFile('0'.repeat(64)+'.png')
  if(!check.ok)return {ok:false,error:check.error}
  try{fs.mkdirSync(path.dirname(check.path),{recursive:true});shell.showItemInFolder(path.dirname(check.path));return {ok:true}}catch{return {ok:false,error:'无法打开图片目录，请检查磁盘和权限'}}
 })
}
