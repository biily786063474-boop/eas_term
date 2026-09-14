// 空闲看门狗：主进程每 30 秒看一眼主窗口渲染进程的 CPU；「没有会话在跑、没有采麦，
// 渲染进程却连续一分钟超过 20%」时，给渲染层附一次调试器，抓 5 秒 JS CPU profile
// 和一份「谁在调定时器 / 谁在动画」的探针，落到 userData/diagnostics/，黑匣子里记一行摘要。
//
// 与黑匣子的「空闲零开销」纪律的关系：轮询只在主进程（`app.getAppMetrics()` 几个系统调用），
// 渲染层平时**一个字节都不碰**，只有触发时才被附上 5 秒。
// 与 diagLog.cpuSnapshot 的关系：`percentCPUUsage` 是「距上次 getAppMetrics 调用」的平均，
// 两边共用同一个计数窗口 —— 这里每 30 秒调一次，意味着黑匣子长任务事件里那份 CPU 读数
// 的窗口从此最长 30 秒（以前是「距上一个事件」，可能几小时），更准了，不是更差。
//
// 决策与汇总是纯函数（idleWatchdogPolicy.ts），这里只管 electron 那一层。
import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIdleWatchdogPolicy, summarizeCpuProfile, type CpuProfileLike } from './idleWatchdogPolicy.ts'

export interface IdleWatchdogDeps {
  window: () => BrowserWindow | null
  /** 任一 AI 会话 turn 未结束 */
  anySessionBusy: () => boolean
  /** 任一语音服务（VAD / 采麦 / 流式识别）在跑 */
  voiceActive: () => boolean
  /** 写黑匣子那一行 */
  log: (what: string) => void
  /** 产物目录（默认 userData/diagnostics） */
  outDir?: string
  intervalMs?: number
  threshold?: number
}

/** 在渲染层跑 4 秒的探针：谁在调 rAF / 定时器、读了多少次布局、哪些动画在跑。
 *  全程只加计数不改行为，4 秒后把补丁全部还原。**不动 console、不动 window.api**。 */
const PROBE = `new Promise(done=>{
 const C={raf:{},to:{},iv:{},layout:0};
 const key=f=>{try{return (f&&f.toString?f.toString():String(f)).replace(/\\s+/g,' ').slice(0,80)}catch{return '?'}};
 const oRAF=window.requestAnimationFrame.bind(window),oST=window.setTimeout.bind(window),oSI=window.setInterval.bind(window),oGB=Element.prototype.getBoundingClientRect;
 window.requestAnimationFrame=cb=>oRAF(ts=>{const k=key(cb);C.raf[k]=(C.raf[k]||0)+1;return cb(ts)});
 window.setTimeout=(cb,ms,...a)=>oST(()=>{const k=(ms|0)+'ms '+key(cb);C.to[k]=(C.to[k]||0)+1;return typeof cb==='function'?cb(...a):undefined},ms,...a);
 window.setInterval=(cb,ms,...a)=>oSI(()=>{const k=(ms|0)+'ms '+key(cb);C.iv[k]=(C.iv[k]||0)+1;return cb(...a)},ms,...a);
 Element.prototype.getBoundingClientRect=function(){C.layout++;return oGB.call(this)};
 oST(()=>{
  window.requestAnimationFrame=oRAF;window.setTimeout=oST;window.setInterval=oSI;Element.prototype.getBoundingClientRect=oGB;
  const top=(o,n)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n);
  const vis=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth};
  const anims={};for(const a of document.getAnimations()){let props=[];try{props=[...new Set(a.effect.getKeyframes().flatMap(k=>Object.keys(k).filter(p=>!/^(offset|computedOffset|easing|composite)$/.test(p))))]}catch{}
   const t=a.effect&&a.effect.target;const k=(a.animationName||a.transitionProperty||a.constructor.name)+' ['+props.join(',')+'] '+(t?t.tagName.toLowerCase()+'.'+[...t.classList].slice(0,3).join('.'):'?')+(t&&vis(t)?' 可见':' 视口外');anims[k]=(anims[k]||0)+1}
  done({seconds:4,raf:top(C.raf,8),timeouts:top(C.to,8),intervals:top(C.iv,8),layoutReads:C.layout,animations:top(anims,12),hasFocus:document.hasFocus(),hidden:document.hidden,selectedPanes:document.querySelectorAll('.pane.sel').length});
 },4000);
})`

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function installIdleWatchdog(deps: IdleWatchdogDeps): () => void {
  const intervalMs = deps.intervalMs ?? 30_000
  const policy = createIdleWatchdogPolicy({ threshold: deps.threshold ?? 20, consecutive: 2, cooldownMs: 10 * 60_000, maxCaptures: 5 })
  const outDir = deps.outDir ?? path.join(app.getPath('userData'), 'diagnostics')
  let capturing = false
  // 预热：第一次 getAppMetrics 恒为 0（见 diagLog.cpuSnapshot 的注释）
  try { app.getAppMetrics() } catch { /* 无所谓 */ }

  const tick = (): void => {
    if (capturing) return
    const win = deps.window()
    if (!win || win.isDestroyed()) return
    let rendererCpu = Number.NaN
    let gpuCpu = Number.NaN
    try {
      // ⚠️ `percentCPUUsage` 是按**全部核心**归一化的：主线程烧满在 15 核机器上只读到 7%
      // （2026-09-14 隔离实例实测）。乘回核数换成「单核百分比」，和 top / ps 的口径一致，
      // 阈值 20 才是「占了 1/5 个核」而不是「三个整核」。
      const cores = Math.max(1, os.availableParallelism())
      const pid = win.webContents.getOSProcessId()
      for (const m of app.getAppMetrics()) {
        const pct = m.cpu?.percentCPUUsage
        if (m.pid === pid) rendererCpu = pct === undefined ? Number.NaN : pct * cores
        else if (m.type === 'GPU') gpuCpu = pct === undefined ? Number.NaN : pct * cores
      }
    } catch {
      return
    }
    const decision = policy.next({ at: performance.now(), rendererCpu, busy: deps.anySessionBusy(), voice: deps.voiceActive() })
    if (decision !== 'capture') return
    capturing = true
    void capture(win, rendererCpu, gpuCpu).finally(() => { capturing = false })
  }

  const capture = async (win: BrowserWindow, rendererCpu: number, gpuCpu: number): Promise<void> => {
    const dbg = win.webContents.debugger
    // 别人（DevTools / 验收脚本）已经附着时不抢 —— 抢了会把对方踢掉
    if (dbg.isAttached()) {
      deps.log(`渲染 ${rendererCpu.toFixed(0)}% 持续超线，但调试器已被占用，这次不抓`)
      return
    }
    const head = `渲染 ${rendererCpu.toFixed(0)}% · GPU ${Number.isFinite(gpuCpu) ? gpuCpu.toFixed(0) : '?'}%（单核口径）空闲超线 ≥ ${Math.round(intervalMs / 1000)}s ×2`
    try {
      dbg.attach('1.3')
      await dbg.sendCommand('Profiler.enable')
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 500 })
      await dbg.sendCommand('Profiler.start')
      const probeP = dbg.sendCommand('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: true }) as Promise<{ result?: { value?: unknown } }>
      await new Promise((r) => setTimeout(r, 5000))
      const { profile } = (await dbg.sendCommand('Profiler.stop')) as { profile: CpuProfileLike }
      const probe = (await probeP.catch(() => null))?.result?.value ?? null
      const summary = summarizeCpuProfile(profile)
      fs.mkdirSync(outDir, { recursive: true })
      const base = path.join(outDir, `idle-${stamp()}`)
      fs.writeFileSync(base + '.cpuprofile', JSON.stringify(profile))
      fs.writeFileSync(base + '.json', JSON.stringify({ rendererCpu, gpuCpu, summary, probe }, null, 1))
      const top = summary.top.slice(0, 3).map((t) => `${t.name} ${t.ms}ms`).join(' · ') || '（无 JS）'
      const probeLine = probe && typeof probe === 'object'
        ? ` | rAF ${(probe as { raf: unknown[] }).raf.length} 种 · 定时器 ${(probe as { timeouts: unknown[] }).timeouts.length + (probe as { intervals: unknown[] }).intervals.length} 种 · 布局读取 ${(probe as { layoutReads: number }).layoutReads} · 动画 ${(probe as { animations: unknown[] }).animations.length} 种`
        : ''
      deps.log(`${head} → 已抓 ${path.basename(base)} | JS 忙 ${summary.busyPercent}% · ${top}${probeLine}`)
    } catch (e) {
      deps.log(`${head} → 抓取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      try { if (dbg.isAttached()) dbg.detach() } catch { /* 已经脱开 */ }
    }
  }

  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
