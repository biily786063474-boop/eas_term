// 离线语音转文字(STT)服务 —— 混合双模型，零 key、离线、隐私：
//  · 录音中：流式 zipformer(streaming) 实时出「易变预览」(partial)，边说边看，手感好但准确率一般；
//  · 停手时：用离线大模型 SenseVoice 对「整段缓存音频」重跑一次，出「准确定稿」(带标点/数字规整)，
//    准确率高一档。渲染层：录音显灰色 interim 预览，停手把 SenseVoice 定稿写进终端。
//  · SenseVoice 模型缺失/加载失败 → 优雅回退到流式的收尾结果，功能不中断。
import { app, ipcMain, systemPreferences, WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

// 模型目录：dev 用项目 resources/models；打包用 process.resourcesPath/models(electron-builder extraResources)。
const STREAM_MODEL = 'sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13'
const SENSE_VOICE = 'sherpa-onnx-sense-voice'
function modelDir(name: string): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'models', name)]
    : [
        path.join(app.getAppPath(), 'resources', 'models', name),
        path.join(process.cwd(), 'resources', 'models', name)
      ]
  return candidates.find((d) => fs.existsSync(d)) ?? null
}

// 在模型目录里找 encoder/decoder/joiner（优先 int8 量化版）
function pick(dir: string, kind: 'encoder' | 'decoder' | 'joiner'): string {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(kind) && f.endsWith('.onnx'))
  const int8 = files.find((f) => f.includes('int8'))
  return path.join(dir, int8 ?? files[0] ?? `${kind}.onnx`)
}

// ---------- 流式识别器（录音中实时预览） ----------
interface Recognizer {
  createStream(): unknown
  isReady(s: unknown): boolean
  decode(s: unknown): void
  isEndpoint(s: unknown): boolean
  getResult(s: unknown): { text: string }
  reset(s: unknown): void
}
let recognizer: Recognizer | null = null
let loadError: string | null = null
function ensureRecognizer(): Recognizer | null {
  if (recognizer || loadError) return recognizer
  const dir = modelDir(STREAM_MODEL)
  if (!dir) {
    loadError = '未找到流式语音模型(resources/models/…)'
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sherpa = require('sherpa-onnx')
    recognizer = sherpa.createOnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: pick(dir, 'encoder'),
          decoder: pick(dir, 'decoder'),
          joiner: pick(dir, 'joiner')
        },
        tokens: path.join(dir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: 1,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.0,
      rule3MinUtteranceLength: 20
    }) as Recognizer
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
    console.error('[stt] 加载流式识别器失败', e)
  }
  return recognizer
}

// ---------- 离线识别器 SenseVoice（停手定稿，更准） ----------
interface OfflineRecognizer {
  createStream(): unknown
  decode(s: unknown): void
  getResult(s: unknown): { text: string }
}
let offline: OfflineRecognizer | null = null
let offlineError: string | null = null
function ensureOffline(): OfflineRecognizer | null {
  if (offline || offlineError) return offline
  const dir = modelDir(SENSE_VOICE)
  if (!dir) {
    offlineError = '未找到 SenseVoice 离线模型'
    return null
  }
  const model = ['model.int8.onnx', 'model.onnx']
    .map((f) => path.join(dir, f))
    .find((p) => fs.existsSync(p))
  if (!model) {
    offlineError = 'SenseVoice 模型文件缺失'
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sherpa = require('sherpa-onnx')
    offline = sherpa.createOfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model, language: 'auto', useInverseTextNormalization: 1 },
        tokens: path.join(dir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      },
      decodingMethod: 'greedy_search'
    }) as OfflineRecognizer
  } catch (e) {
    offlineError = e instanceof Error ? e.message : String(e)
    console.error('[stt] 加载 SenseVoice 失败,回退流式', e)
  }
  return offline
}

// 用 SenseVoice 对整段音频出定稿；失败/无模型返回 null（调用方回退流式）
function transcribeOffline(samples: Float32Array): string | null {
  const r = ensureOffline()
  if (!r) return null
  try {
    const s = r.createStream()
    ;(s as { acceptWaveform(sr: number, x: Float32Array): void }).acceptWaveform(16000, samples)
    r.decode(s)
    return r.getResult(s).text.trim()
  } catch (e) {
    console.error('[stt] SenseVoice 识别失败,回退流式', e)
    return null
  }
}

// 会话态（单窗口够用）
let stream: unknown = null // 流式流
let chunks: Float32Array[] = [] // 录音期间缓存的原始音频(供停手离线重跑)
let committed = '' // 已过端点的流式片段累积(interim 预览用)

function concatChunks(): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export function registerSttHandlers(): void {
  ipcMain.handle('stt:start', async (): Promise<{ ok: boolean; error?: string }> => {
    // macOS 系统麦克风权限
    if (process.platform === 'darwin') {
      const st = systemPreferences.getMediaAccessStatus('microphone')
      if (st !== 'granted') {
        const ok = await systemPreferences.askForMediaAccess('microphone')
        if (!ok) return { ok: false, error: '麦克风权限被拒绝' }
      }
    }
    const r = ensureRecognizer()
    if (!r) return { ok: false, error: loadError ?? '识别器不可用' }
    stream = r.createStream()
    chunks = []
    committed = ''
    return { ok: true }
  })

  // 渲染进程送来的 16kHz Int16 PCM 帧：喂流式出预览 + 缓存原始音频供停手离线重跑
  ipcMain.on('stt:audio', (e, buf: ArrayBuffer) => {
    const r = recognizer
    if (!r || !stream) return
    try {
      const i16 = new Int16Array(buf)
      const f32 = new Float32Array(i16.length)
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
      chunks.push(f32) // 缓存整段音频
      // sherpa 的 acceptWaveform 是「位置参数」(sampleRate, samples)
      ;(stream as { acceptWaveform(sr: number, s: Float32Array): void }).acceptWaveform(16000, f32)
      while (r.isReady(stream)) r.decode(stream)
      const seg = r.getResult(stream).text.trim()
      const wc = e.sender as WebContents
      // 只做「易变预览」：不逐段写终端(定稿统一等停手用 SenseVoice 出)，interim 显累积的运行文本
      if (r.isEndpoint(stream)) {
        committed = (committed + seg).trim()
        r.reset(stream)
        if (!wc.isDestroyed()) wc.send('stt:partial', committed)
      } else if (!wc.isDestroyed()) {
        wc.send('stt:partial', (committed + seg).trim())
      }
    } catch (err) {
      console.error('[stt:audio]', err)
    }
  })

  ipcMain.handle('stt:stop', (): { text: string } => {
    const r = recognizer
    // 先收掉流式(拿回退用的尾段 + 释放)
    let streamTail = ''
    if (r && stream) {
      try {
        ;(stream as { inputFinished(): void }).inputFinished()
        while (r.isReady(stream)) r.decode(stream)
        streamTail = r.getResult(stream).text.trim()
      } catch {
        /* 忽略 */
      }
    }
    // 优先用 SenseVoice 对整段音频出准确定稿；无模型/失败 → 回退流式(累积 + 尾段)
    const all = chunks.length ? concatChunks() : new Float32Array(0)
    const offlineText = all.length ? transcribeOffline(all) : null
    const text = offlineText ?? (committed + streamTail).trim()
    stream = null
    chunks = []
    committed = ''
    return { text }
  })
}
