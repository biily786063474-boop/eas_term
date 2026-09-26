import {ResourceWaitTimeoutError} from './scheduler.ts'
export function startupFailure(error:unknown):{fatal:boolean;message:string}{
 const message=error instanceof Error?error.message:String(error)
 if(message==='cancelled'||message==='对话启动已取消')return {fatal:false,message:'已取消等待，本次消息未启动，不会自动重试。'}
 if(error instanceof ResourceWaitTimeoutError)return {fatal:false,message:'等待资源超时，本次消息未启动。资源恢复后请重新发送，不会自动重试。'}
 return {fatal:true,message:'对话启动未完成：'+message}
}
