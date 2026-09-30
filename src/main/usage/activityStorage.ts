import { tm } from '../../shared/i18n/current.ts'
import fs from 'node:fs'
import { ActivityBook, parseActivity } from './activity.ts'
/** Caller supplies a fixed app-owned path, never a renderer-selected path. */
export class ActivityStore {
 readonly book=new ActivityBook(Date.now())
 error:string|undefined
 disabled=false
 private writing=Promise.resolve()
 private readonly file:string
 constructor(file:string){
  this.file=file
  try{if(fs.existsSync(file)){
   if(fs.statSync(file).size>4*1024*1024)throw Error(tm('errCore.usage.activityTooBig'))
   this.book.data=parseActivity(JSON.parse(fs.readFileSync(file,'utf8')))
   this.book.prune(Date.now())
  }}catch(e){this.disabled=true;this.error=tm('errCore.usage.activityReadFailed', { error: String(e) })}
 }
 async flush():Promise<void>{
  if(this.disabled)return
  this.book.prune(Date.now())
  const text=JSON.stringify(this.book.data)
  this.writing=this.writing.then(async()=>{
   if(Buffer.byteLength(text)>4*1024*1024)throw Error(tm('errCore.usage.activityTooBig'))
   await fs.promises.writeFile(this.file+'.tmp',text,{mode:0o600})
   await fs.promises.rename(this.file+'.tmp',this.file)
  }).then(()=>{this.error=undefined},e=>{this.error=tm('errCore.usage.activitySaveFailed', { error: String(e) })})
  await this.writing
 }
}
