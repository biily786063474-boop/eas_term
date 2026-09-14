// 安装包下载。**零 electron**：request 由调用方注入（生产是 electron.net.request），
// 这样 node --test 能用假请求验证成功 / 取消 / 非 200 三条路。
// 先写 .part、下完再改名：中途断了不会在「下载」里留下一个看着完整、其实缺一截的 dmg。
// 取消 = abort 请求 + 删 .part + 拒绝（2026-09-13 接资源准入时加的，之前不可取消）。
import fs from 'fs'
import type {EventEmitter} from 'node:events'

export interface DownloadRequest extends EventEmitter { abort():void; end():void }
export interface DownloadResponse extends EventEmitter { statusCode:number; headers:Record<string,string|string[]|undefined> }

export function downloadFile(opts:{
 url:string;dest:string
 request:(url:string)=>DownloadRequest
 onProgress:(got:number,total:number)=>void
 signal?:AbortSignal
}):Promise<string>{
 return new Promise((resolve,reject)=>{
  if(opts.signal?.aborted){reject(Error('更新包下载已取消'));return}
  const tmp=opts.dest+'.part'
  const req=opts.request(opts.url)
  let out:fs.WriteStream|null=null,settled=false
  const finish=(fn:()=>void)=>{if(settled)return;settled=true;opts.signal?.removeEventListener('abort',onAbort);fn()}
  // destroy 掉写流后，还在缓冲里的写入会以 error 事件冒出来；这里已经在收拾了，吞掉它
  const cleanup=()=>{if(out){out.on('error',()=>{});out.destroy()}fs.rmSync(tmp,{force:true})}
  const onAbort=()=>{try{req.abort()}catch{/* 已经结束 */}cleanup();finish(()=>reject(Error('更新包下载已取消')))}
  opts.signal?.addEventListener('abort',onAbort,{once:true})
  req.on('response',(res:DownloadResponse)=>{
   if(res.statusCode!==200){res.on('data',()=>{});finish(()=>reject(Error(`下载失败：服务器返回 ${res.statusCode}`)));return}
   const total=Number(res.headers['content-length']??0)
   let got=0
   out=fs.createWriteStream(tmp)
   res.on('data',(c:Buffer)=>{if(settled)return;got+=c.length;out!.write(Buffer.from(c));opts.onProgress(got,total)})
   res.on('end',()=>{if(settled)return;out!.end(()=>{try{fs.renameSync(tmp,opts.dest);finish(()=>resolve(opts.dest))}catch(e){cleanup();finish(()=>reject(e as Error))}})})
   res.on('error',(e:Error)=>{cleanup();finish(()=>reject(e))})
  })
  req.on('error',(e:Error)=>{cleanup();finish(()=>reject(e))})
  req.end()
 })
}
