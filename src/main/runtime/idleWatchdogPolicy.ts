// 空闲看门狗的两段纯逻辑（不 import electron，`node --test` 裸跑）：
//   · 策略：什么时候算「空闲却在烧」、什么时候该抓一份现场
//   · 汇总：把一份 CPU profile 压成几行能写进黑匣子的文字
//
// 为什么要它（2026-09-14）：正式版空闲时渲染主线程 25%、GPU 40% 持续了 25 分钟，
// 事后自己消失，再也复现不出。当时能做的只有外面 `ps` / `sample`，脱符号，看不出是哪段 JS。
// 黑匣子只记事件（重挂 / 长任务），这种「很多小任务」它抓不到。
// 所以下次再烧起来时，让主进程自己在现场抓 5 秒 JS profile —— 有了函数名和行号就不用猜。

export interface WatchdogSample {
  /** 单调毫秒 */
  at: number
  /** 主窗口渲染进程这一段的平均 CPU（`percentCPUUsage`，距上次采样） */
  rendererCpu: number
  /** 有 AI 会话在跑（turn 未结束）—— pane 在动是正常的，不算空闲 */
  busy: boolean
  /** 麦克风在采集 —— 人声检测跑在渲染层，也不算空闲 */
  voice: boolean
}

export type WatchdogDecision = 'skip' | 'idle' | 'watch' | 'capture' | 'cooldown' | 'exhausted'

export interface WatchdogOptions {
  /** 渲染进程 CPU 超过这个百分比才算「在烧」 */
  threshold: number
  /** 连续几次超阈值才抓（两次 = 至少一个采样周期以上，排除一闪而过的高峰） */
  consecutive: number
  /** 两次抓取之间至少隔多久 */
  cooldownMs: number
  /** 一次运行最多抓几份 —— 磁盘与主线程都别被一个反复发作的问题吃光 */
  maxCaptures: number
}

export function createIdleWatchdogPolicy(opts: WatchdogOptions) {
  let streak = 0
  let captures = 0
  let lastCaptureAt = Number.NEGATIVE_INFINITY
  return {
    next(s: WatchdogSample): WatchdogDecision {
      if (s.busy || s.voice) {
        streak = 0
        return 'skip'
      }
      if (!Number.isFinite(s.rendererCpu) || s.rendererCpu < 0) {
        streak = 0
        return 'idle'
      }
      if (s.rendererCpu < opts.threshold) {
        streak = 0
        return 'idle'
      }
      streak += 1
      if (streak < opts.consecutive) return 'watch'
      // 到这里已经连续超线；冷却 / 配额只决定抓不抓，不决定要不要继续数
      if (captures >= opts.maxCaptures) return 'exhausted'
      if (s.at - lastCaptureAt < opts.cooldownMs) return 'cooldown'
      captures += 1
      lastCaptureAt = s.at
      // streak 不归零：还在烧的话下一次直接进冷却判断，冷却一结束就再抓一份
      return 'capture'
    }
  }
}

/** CDP `Profiler.stop` 返回的那份，只取这里用到的字段 */
export interface CpuProfileLike {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]
  samples: number[]
  timeDeltas: number[]
}

const NON_WORK = new Set(['(idle)', '(program)', '(garbage collector)', '(root)'])

/** 按 self time 排前几名。名字带文件名与行号（bundle 是压缩过的，行号是唯一能对回源码的线索） */
export function summarizeCpuProfile(profile: CpuProfileLike, topN = 8): { busyPercent: number; top: { name: string; ms: number }[] } {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const selfUs = new Map<number, number>()
  let totalUs = 0
  let busyUs = 0
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0
    totalUs += dt
    const id = profile.samples[i]
    selfUs.set(id, (selfUs.get(id) ?? 0) + dt)
    const fn = byId.get(id)?.callFrame.functionName ?? ''
    if (!NON_WORK.has(fn)) busyUs += dt
  }
  const rows = [...selfUs.entries()]
    .map(([id, us]) => {
      const cf = byId.get(id)?.callFrame
      if (!cf || NON_WORK.has(cf.functionName)) return null
      const file = cf.url.split('/').pop() || '?'
      return { name: `${cf.functionName || '(anon)'} @ ${file}:${cf.lineNumber}`, ms: Math.round(us / 100) / 10 }
    })
    .filter((r): r is { name: string; ms: number } => r !== null)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, topN)
  const busyPercent = totalUs > 0 ? Math.round((busyUs / totalUs) * 1000) / 10 : 0
  return { busyPercent, top: rows }
}
