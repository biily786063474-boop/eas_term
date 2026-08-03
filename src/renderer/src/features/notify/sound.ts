// 待处理提示音：Web Audio 现场合成，没有音频文件。
//
// 不用采样的理由：一个像样的 wav 提示音 30–80KB，而这是个每天要响很多次的小提示，
// 为它往包里塞资源不划算；合成的还能随时改参数（嫌高了改一个数字），
// 而且「清脆」正是合成音的强项——纯正弦 + 快速指数衰减，比大多数采样都干净。
//
// 音色是「木琴」：基频 + 4 倍泛音、0.2 秒响完、无拖尾。
// 选它是因为多任务并行时会连着响，衰减长的音（钟/玻璃）尾音会互相打架。
// 参数与 docs/灵动岛提示音-试听原型.html 的 C 组**逐字一致**——
// 你在那页听到的就是这里发出的声音，改这里也要同步改那页，否则试听就成了骗人的。

const LS_ENABLED = 'eas.sound.enabled'
const LS_VOLUME = 'eas.sound.volume'

/** 木琴的泛音：基频 + 4 倍频（很轻）。整数倍里 4 倍最接近木头共鸣，2 倍会发闷 */
const WOOD: [number, number][] = [
  [1, 1],
  [4.0, 0.15]
]

/** 同类提示的最小间隔。低于它的重复触发直接吞掉——
 *  三个任务几乎同时完成不该响三声。 */
const THROTTLE_MS = 1200

let ctx: AudioContext | null = null
let master: GainNode | null = null
let dry: GainNode | null = null
let reverb: ConvolverNode | null = null
let lastPlayAt = 0

/** 默认音量。比系统提示音略轻——它一天要响很多次 */
const DEFAULT_VOLUME = 0.28

function readVolume(): number {
  const raw = localStorage.getItem(LS_VOLUME)
  // **必须先判 null。** `Number(null)` 是 0 而不是 NaN，直接 Number() 再校验范围的话
  // 「没存过」会被当成「存了 0」通过校验，默认音量就成了静音——
  // 用户开着提示音却一个声音都听不到，还以为功能坏了。
  if (raw === null) return DEFAULT_VOLUME
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME
}

export function isSoundEnabled(): boolean {
  return localStorage.getItem(LS_ENABLED) !== '0'
}

export function setSoundEnabled(v: boolean): void {
  localStorage.setItem(LS_ENABLED, v ? '1' : '0')
}

export function getVolume(): number {
  return readVolume()
}

export function setVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, v))
  localStorage.setItem(LS_VOLUME, String(clamped))
  if (master) master.gain.value = clamped
}

/** 懒初始化。AudioContext 是稀缺资源（每个页面有数量上限），
 *  不响的时候一个都不建。 */
function ensureCtx(): boolean {
  if (ctx) return true
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = readVolume()

    // 低通削掉过亮的高频。这一条是「贵」和「尖」的分界线——
    // 不加的话 4 倍泛音在 4kHz 以上很扎耳朵。
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 7200
    lp.Q.value = 0.7
    master.connect(lp)
    lp.connect(ctx.destination)

    // 混响用程序生成的脉冲响应：0.9 秒指数衰减噪声。同样不需要任何音频文件。
    // 干音贴着耳朵响像手机通知，有一点空间感才不廉价。
    const len = Math.floor(ctx.sampleRate * 0.9)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    reverb = ctx.createConvolver()
    reverb.buffer = buf
    const wet = ctx.createGain()
    wet.gain.value = 0.3
    dry = ctx.createGain()
    dry.gain.value = 0.82
    dry.connect(master)
    reverb.connect(wet)
    wet.connect(master)
    return true
  } catch {
    // 没有音频设备 / 被策略挡住：静默降级，绝不因为提示音报错影响主流程
    ctx = null
    return false
  }
}

/** 一个音：基频加若干泛音，各自独立包络 */
function tone(freq: number, at: number, dur: number, gain: number): void {
  if (!ctx || !dry) return
  const t0 = ctx.currentTime + at
  for (const [mult, amp] of WOOD) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine' // 方波/锯齿富含奇次谐波，听感廉价刺耳
    osc.frequency.value = freq * mult
    // 高次泛音衰减更快，和真实物体一致。这条比泛音比例本身还影响听感
    const d = dur * (mult > 1 ? 0.62 : 1)
    // 指数衰减而非线性：线性的尾巴发「木」，不像真实振动
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amp), t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
    osc.connect(g)
    g.connect(dry)
    if (reverb) g.connect(reverb)
    osc.start(t0)
    osc.stop(t0 + d + 0.05)
  }
}

/**
 * 播一条提示音。两种类型音色同源、靠音程和节奏区分——
 * 「两个毫不相干的声音」听起来不像一个产品。
 *
 * - done：C6→G6 短促上行五度，落定感
 * - approval：G5 敲两下再收到 C6，重复音是「催」的节奏
 */
export function playNotice(kind: 'done' | 'approval'): void {
  if (!isSoundEnabled()) return
  const now = Date.now()
  if (now - lastPlayAt < THROTTLE_MS) return
  if (!ensureCtx() || !ctx) return
  lastPlayAt = now
  // 页面长时间没声音时 AudioContext 会被挂起，播之前先唤醒
  if (ctx.state === 'suspended') void ctx.resume()

  if (kind === 'approval') {
    tone(784, 0, 0.18, 0.5)
    tone(784, 0.06, 0.18, 0.45)
    tone(1046.5, 0.12, 0.2, 0.45)
  } else {
    tone(1046.5, 0, 0.22, 0.55)
    tone(1568, 0.055, 0.22, 0.45)
  }
}

/** 设置面板里的「试听」用：绕过节流，否则连点两下第二下没声音会让人以为坏了 */
export function previewNotice(kind: 'done' | 'approval'): void {
  lastPlayAt = 0
  const wasEnabled = isSoundEnabled()
  if (!wasEnabled) return
  playNotice(kind)
}
