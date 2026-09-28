import { app } from 'electron'
import path from 'node:path'
import { ActivityStore } from './activityStorage.ts'
let store:ActivityStore|undefined
let timer:ReturnType<typeof setTimeout>|undefined
export function activityStore():ActivityStore {
 if(!store)store=new ActivityStore(path.join(app.getPath('userData'),'usage-activity.json'))
 return store
}
function schedule():void {
 if(timer)return
 timer=setTimeout(()=>{timer=undefined;void activityStore().flush()},1000)
}
/** Failure must never affect the action being measured. No prompts or tool arguments accepted. */
export function captureActivity(key:unknown):void {
 try{const s=activityStore();if(!s.disabled&&s.book.record(key,Date.now()))schedule()}catch{/* statistics are best effort */}
}
export function capturePluginActivity(id:string,kind:'open'|'call'):void {
 try{const s=activityStore();if(!s.disabled&&s.book.recordPlugin(id,kind,Date.now()))schedule()}catch{/* statistics are best effort */}
}
export async function flushActivity():Promise<void>{
 if(timer){clearTimeout(timer);timer=undefined}
 await activityStore().flush()
}
