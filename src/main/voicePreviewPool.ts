// 流式识别 worker 的常驻池：只有一条 link，用完不杀、闲置到时再杀。
//
// 为什么常驻：每次录音重建 worker 要重新加载 74MB 模型，实测 2.8 秒（WASM 版 onnxruntime），
// 用户每按一次麦克风都等这 3 秒。常驻之后第一次 3 秒，之后每次录音 1ms（换个 stream）。
// 代价：常驻期间约 95MB（隔离实例实测 rss 增量）。闲置 idleMs 没人用就释放，退出时 drop。
//
// 不 import electron、不碰 worker_threads：link 由调用方造（stt.ts），这里只管「留着还是杀」。
import type {PreviewLink} from './voicePreviewSession'

export interface VoicePreviewPool {
 /** 拿到一条活着的 link（没有就建）。取消闲置计时。 */
 acquire(): PreviewLink
 /** 这次录音用完了：开始闲置计时，到时释放。 */
 release(): void
 /** 立刻释放（退出 / 内存压力）。幂等。 */
 drop(): void
 warm(): boolean
}

export function createVoicePreviewPool(deps:{create:()=>PreviewLink;idleMs:number;setTimer:(fn:()=>void,ms:number)=>unknown;clearTimer:(handle:unknown)=>void}):VoicePreviewPool{
 let link:PreviewLink|null=null
 let idle:unknown=null
 const clearIdle=()=>{if(idle!==null){deps.clearTimer(idle);idle=null}}
 const drop=()=>{clearIdle();const l=link;link=null;if(l&&l.alive)l.terminate()}
 return {
  acquire(){
   clearIdle()
   if(link&&link.alive)return link
   const created=deps.create()
   link=created
   // worker 自己死了（崩溃 / fatal）就别再发出去；下次 acquire 重建
   void created.exited.then(()=>{if(link===created)link=null})
   return created
  },
  release(){
   if(!link)return
   clearIdle()
   idle=deps.setTimer(()=>{idle=null;drop()},deps.idleMs)
  },
  drop,
  warm(){return !!link&&link.alive}
 }
}
