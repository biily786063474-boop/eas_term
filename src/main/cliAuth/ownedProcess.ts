import {ownedSessions} from '../runtime/ownedSessions.ts'

/** 把一个主进程自己起的 CLI 进程（安装脚本 / 交互式登录）登记成运行中心里
 *  **可见、可停（一次确认）、真实退出才消失**的自有服务。
 *
 *  不排队：登录是用户交互，安装按方案不可任意中断；这里只做归属与停止入口。
 *  completed 只认进程的 close（或起不来时的 error），不认 kill() 的返回。
 *  stop 交给调用方既有的取消函数（cancelLogin / cancelInstall），不另起一套杀法。 */
export function registerOwnedCliProcess(input:{
 sessions?:Pick<typeof ownedSessions,'add'>
 id:string;name:string;windowId:number;proc:{once(event:'close'|'error',listener:(...args:unknown[])=>void):unknown;readonly pid?:number};stop:()=>void
}):{completed:Promise<void>}{
 const completed=new Promise<void>(resolve=>{
  input.proc.once('close',()=>resolve())
  input.proc.once('error',()=>{if(!input.proc.pid)resolve()})
 })
 ;(input.sessions??ownedSessions).add({id:input.id,name:input.name,windowId:input.windowId,projectId:null,kind:'cli',completed,stop:input.stop})
 return {completed}
}
