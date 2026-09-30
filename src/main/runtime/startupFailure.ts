import { tm } from '../../shared/i18n/current.ts'
import {ResourceWaitTimeoutError} from './scheduler.ts'
export function startupFailure(error:unknown):{fatal:boolean;message:string}{
 const message=error instanceof Error?error.message:String(error)
 if(message==='cancelled'||message==='对话启动已取消')return {fatal:false,message:tm('errCore.rt.waitCanceled')}
 if(error instanceof ResourceWaitTimeoutError)return {fatal:false,message:tm('errCore.rt.waitTimeout')}
 return {fatal:true,message:tm('errCore.rt.startIncomplete', { message })}
}
