// 离线语音转文字(STT)服务：用 sherpa-onnx 的流式 Paraformer(中英双语)在主进程做实时识别。
// 零 key、离线、隐私、中文强。渲染进程采麦 → PCM(16kHz Int16)经 IPC 送来 → 喂识别器 →
// 流式回传 partial(易变)/ final(定稿,端点检测触发)。provider 抽象：目前只 local；云端可后加。

import { app, ipcMain, systemPreferences, WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

// 模型目录：dev 用项目 resources/models；打包用 process.resourcesPath/models(electron-builder extraResources)。
// 用流式 zipformer(transducer) 中文模型(multi-zh-hans int8，~59MB，中文强)。
const MODEL_NAME = 'sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13'
function modelDir(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'models', MODEL_NAME)]
    : [
        path.join(app.getAppPath(), 'resources', 'models', MODEL_NAME),
        path.join(process.cwd(), 'resources', 'models', MODEL_NAME)
      ]
  return candidates.find((d) => fs.existsSync(d)) ?? null
}

// 在模型目录里找 encoder/decoder/joiner（优先 int8 量化版，体积小、够用）
function pick(dir: string, kind: 'encoder' | 'decoder' | 'joiner'): string {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(kind) && f.endsWith('.onnx'))
  const int8 = files.find((f) => f.includes('int8'))
  return path.join(dir, int8 ?? files[0] ?? `${kind}.onnx`)
}

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

// 懒加载识别器（首次开始识别时才建，避免拖慢启动 + 无模型时优雅报错）
function ensureRecognizer(): Recognizer | null {
  if (recognizer || loadError) return recognizer
  const dir = modelDir()
  if (!dir) {
    loadError = '未找到语音模型(resources/models/…)'
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
    console.error('[stt] 加载识别器失败', e)
  }
  return recognizer
}

// 每个渲染会话一条流(单窗口够用；多窗口可按 wcId 分)
let stream: unknown = null

export function registerSttHandlers(): void {
  ipcMain.handle('stt:start', async (e): Promise<{ ok: boolean; error?: string }> => {
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
    void e
    return { ok: true }
  })

  // 渲染进程送来的 16kHz Int16 PCM 帧
  ipcMain.on('stt:audio', (e, buf: ArrayBuffer) => {
    const r = recognizer
    if (!r || !stream) return
    try {
      const i16 = new Int16Array(buf)
      const f32 = new Float32Array(i16.length)
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
      // 注意:sherpa 的 acceptWaveform 是「位置参数」(sampleRate, samples),不是对象
      ;(stream as { acceptWaveform(sr: number, s: Float32Array): void }).acceptWaveform(16000, f32)
      while (r.isReady(stream)) r.decode(stream)
      const seg = r.getResult(stream).text.trim()
      const wc = e.sender as WebContents
      if (r.isEndpoint(stream)) {
        // 端点 → 该段定稿(逐段回传，渲染层立即写进终端)
        if (seg && !wc.isDestroyed()) wc.send('stt:final', seg)
        r.reset(stream)
        if (!wc.isDestroyed()) wc.send('stt:partial', '')
      } else if (!wc.isDestroyed()) {
        wc.send('stt:partial', seg)
      }
    } catch (err) {
      console.error('[stt:audio]', err)
    }
  })

  ipcMain.handle('stt:stop', (): { text: string } => {
    // 收尾：只返回当前「未到端点」的残段（已到端点的段落早经 stt:final 写过，不重复）
    let tail = ''
    const r = recognizer
    if (r && stream) {
      try {
        ;(stream as { inputFinished(): void }).inputFinished()
        while (r.isReady(stream)) r.decode(stream)
        tail = r.getResult(stream).text.trim()
      } catch {
        /* 忽略 */
      }
    }
    stream = null
    return { text: tail }
  })
}
