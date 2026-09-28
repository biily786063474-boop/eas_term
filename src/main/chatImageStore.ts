/** App-owned content-addressed originals. No URL fetching or model supplied paths. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {safeChatImages,chatImageName,CHAT_IMAGE_EXT,MAX_IMAGE_BYTES,type ChatImage} from '../shared/chatImages.ts'
type Guard=(name:string)=>{ok:boolean;path?:string;error?:string}
export function createChatImageStore(guard:Guard) {
 const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex')
 const target=(name:string)=>{
  const g=guard(name)
  if(!g.ok||!g.path)throw Error('图片目录不可写或访问被拒绝')
  try{if(fs.lstatSync(g.path).isSymbolicLink())throw Error('图片文件不能是符号链接')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  return g.path
 }
 const read=(im:ChatImage):Buffer=>{
  const name=chatImageName(im);if(!name)throw Error('图片引用无效')
  const file=target(name)
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
  try{
   const st=fs.fstatSync(fd);if(!st.isFile()||st.size>MAX_IMAGE_BYTES)throw Error('图片文件无效或超出安全大小')
   const buffer=Buffer.alloc(MAX_IMAGE_BYTES+1)
   let size=0,n=0
   while(size<buffer.length&&(n=fs.readSync(fd,buffer,size,buffer.length-size,null))>0)size+=n
   if(size>MAX_IMAGE_BYTES)throw Error("图片文件超出安全大小")
   const bytes=buffer.subarray(0,size)
   if(digest(bytes)!==name.split('.')[0])throw Error('图片文件已改变，请恢复原文件')
   return bytes
  }finally{fs.closeSync(fd)}
 }
 const restore=(im:ChatImage,bytes:Buffer)=>{
  const name=chatImageName(im)
  if(!name||bytes.length>MAX_IMAGE_BYTES||digest(bytes)!==name.split('.')[0])throw Error('所选文件不是这张图片的原文件')
  const file=target(name)
  fs.mkdirSync(path.dirname(file),{recursive:true})
  // Revalidate after directory creation; no renderer-specified path reaches fs.
  target(name)
  const tempName=name+'.'+randomUUID()+'.tmp',tmp=target(tempName)
  try{
   fs.writeFileSync(tmp,bytes,{flag:'wx',mode:0o600})
   target(name);fs.renameSync(tmp,file)
  }finally{try{fs.unlinkSync(tmp)}catch{/* already moved */}}
 }
 const persist=(value:unknown):{images:ChatImage[];failures:number;reasons:string[]}=>{
  let failures=0
  const reasons=new Set<string>()
  const images=safeChatImages(value).map(im=>{
   if(chatImageName(im))return im
   const bytes=Buffer.from(im.url.slice(im.url.indexOf(',')+1),'base64')
   const ref={mimeType:im.mimeType,url:'eas-chat-image:'+digest(bytes)+'.'+CHAT_IMAGE_EXT[im.mimeType]}
   try{try{read(ref)}catch{restore(ref,bytes)}}catch(e){failures++;const code=(e as NodeJS.ErrnoException).code;reasons.add(code==="ENOSPC"?"磁盘空间不足":code==="EACCES"||code==="EPERM"?"图片目录没有写入权限":e instanceof Error?e.message:"图片写入失败")}
   return ref
  })
  return {images,failures,reasons:[...reasons]}
 }
 return {persist,read,restore}
}
