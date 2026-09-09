import { voiceAsrWorkerCode } from './voiceAsrWorker'
import { createHash } from 'node:crypto'
import { VoiceGate } from './voiceGate'
import { openVoiceVad, type VadSession } from './voiceVad'
// 离线语音转文字(STT)服务 —— 混合双模型，零 key、离线、隐私：
//  · 录音中：流式 zipformer 出「易变预览」(partial)，边说边看；
//  · 停手时：用离线大模型 SenseVoice 对整段缓存音频重跑，出「准确定稿」(带标点/数字规整)。
//  · SenseVoice 缺失/失败 → 回退流式收尾，不中断。
// 模型「首次使用时下载」：不随包附带(省 ~300MB 包体)，按需从 hf-mirror 拉到 userData/models。
//  dev 若 resources/models 已有则直接用，不触发下载。
import { app, ipcMain, systemPreferences, WebContents } from 'electron'
import { Worker } from 'worker_threads'
import fs from 'fs'
import path from 'path'

const STREAM_MODEL = 'sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13'
const SENSE_VOICE = 'sherpa-onnx-sense-voice'

// 每个模型：需要的文件 + 下载 URL(hf-mirror 国内快)。判定「就绪」= 这些文件都在。
interface ModelSpec {
  name: string
  files: { file: string; url: string; sha256?: string }[]
}
const HF = 'https://hf-mirror.com'
const MODELS: Record<'stream' | 'sense' | 'vad', ModelSpec> = {
  vad: {name: 'sherpa-onnx-silero-vad', files: [{file: 'silero_vad.onnx', sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx'}]},
  stream: {
    name: STREAM_MODEL,
    files: [
      'encoder-epoch-20-avg-1-chunk-16-left-128.int8.onnx',
      'decoder-epoch-20-avg-1-chunk-16-left-128.onnx',
      'joiner-epoch-20-avg-1-chunk-16-left-128.int8.onnx',
      'tokens.txt'
    ].map((f) => ({ file: f, url: `${HF}/csukuangfj/${STREAM_MODEL}/resolve/main/${f}` }))
  },
  sense: {
    name: SENSE_VOICE,
    files: [
      { file: 'model.int8.onnx', url: `${HF}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx` },
      { file: 'tokens.txt', url: `${HF}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt` }
    ]
  }
}

// 下载目标：userData/models（可写）。dev/旧包可能放 resources/models（只读）。
function userModelsRoot(): string {
  return path.join(app.getPath('userData'), 'models')
}
// 候选目录（userData 优先，其次 dev 的 resources / 打包的 resourcesPath）
function candidateDirs(name: string): string[] {
  const c = [path.join(userModelsRoot(), name)]
  if (app.isPackaged) c.push(path.join(process.resourcesPath, 'models', name))
  else {
    c.push(path.join(app.getAppPath(), 'resources', 'models', name))
    c.push(path.join(process.cwd(), 'resources', 'models', name))
  }
  return c
}
// 返回「所有必需文件齐全」的目录；没有则 null
function readyDir(spec: ModelSpec): string | null {
  for (const dir of candidateDirs(spec.name)) {
    if (spec.files.every((f) => {
      const file = path.join(dir, f.file)
      try { return fs.statSync(file).isFile() && (!f.sha256 || createHash('sha256').update(fs.readFileSync(file)).digest('hex') === f.sha256) } catch { return false }
    })) return dir
  }
  return null
}

// 在模型目录里找 encoder/decoder/joiner（优先 int8）
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
async function ensureRecognizer(): Promise<Recognizer | null> {
  if (recognizer || loadError) return recognizer
  const dir = readyDir(MODELS.stream)
  if (!dir) {
    loadError = '流式语音模型未下载'
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runtimeDir = path.dirname(require.resolve('sherpa-onnx'))
    const wasm = await require(path.join(runtimeDir, 'sherpa-onnx-wasm-nodejs.js'))({})
    const binding = require(path.join(runtimeDir, 'sherpa-onnx-asr.js'))
    recognizer = binding.createOnlineRecognizer(wasm, {
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

// ---------- 离线识别器 SenseVoice（跑在 worker 线程，绝不阻塞主进程） ----------
// SenseVoice 解码是 CPU 密集的同步调用（~1s 量级）。放主进程会把整个 app 冻住（IPC 积压、窗口卡顿），
// 与「处理无感知」的目标冲突 → 放进 worker_threads，主进程只发音频、收文本。
let worker: Worker | null = null
let workerDead = false
let seq = 1
const pending = new Map<number, (text: string | null) => void>()

function ensureWorker(): Worker | null {
  if (worker || workerDead) return worker
  const dir = readyDir(MODELS.sense)
  if (!dir) {
    workerDead = true
    return null
  }
  let sherpaPath: string
  try {
    // 传绝对路径进 worker：打包后 asarUnpack 的模块用相对名可能解析不到
    sherpaPath = require.resolve('sherpa-onnx')
  } catch {
    workerDead = true
    return null
  }
  const code = voiceAsrWorkerCode
  try {
    worker = new Worker(code, { eval: true, execArgv: [], workerData: { dir, sherpaPath } })
    worker.unref() // 别因为它挡住退出
    worker.on('message', (m: { type: string; id?: number; text?: string; err?: string }) => {
      if (m.type === 'result' && typeof m.id === 'number') {
        pending.get(m.id)?.(m.text ?? '')
        pending.delete(m.id)
      } else if (m.type === 'fatal') {
        console.error('[stt worker] 初始化失败,回退流式', m.err)
        workerDead = true
        pending.forEach(resolve => resolve(null)); pending.clear()
        void worker?.terminate(); worker = null
      }
    })
    worker.on('error', (e) => {
      console.error('[stt worker] 错误', e)
      worker = null
      pending.forEach((r) => r(null))
      pending.clear()
    })
  } catch (e) {
    console.error('[stt worker] 启动失败', e)
    workerDead = true
    worker = null
  }
  return worker
}

// 异步识别一段音频；worker 不可用/超时 → null（调用方回退流式结果）
//
// timeoutMs 可调：麦克风那条路是短句，20 秒足够；
// 文件转录一段是 20–30 秒音频，CPU 上解码要久一些，用 20 秒卡它会把长句全丢掉。
function transcribeAsync(samples: Float32Array, timeoutMs = 20000): Promise<string | null> {
  if (pending.size >= 8 || samples.length > 16000 * 31) return Promise.resolve(null)
  const w = ensureWorker()
  if (!w) return Promise.resolve(null)
  const id = seq++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    try {
      w.postMessage({ id, samples }, [samples.buffer as ArrayBuffer])
    } catch {
      pending.delete(id)
      resolve(null)
      return
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve(null)
      }
    }, timeoutMs)
  })
}

// ---------- 首次使用下载模型 ----------
let downloading = false
// 下一个文件写到 dir/<file>.part 再原子改名；进度经 stt:downloadProgress 回传渲染层
async function downloadFile(url: string, dest: string, onChunk: (n: number) => void, sha256?: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status} ${url}`)
  const tmp = dest + '.part'
  const out = fs.createWriteStream(tmp)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      onChunk(value.byteLength)
    }
  } finally {
    await new Promise<void>((r) => out.end(r))
  }
  if (sha256 && createHash('sha256').update(fs.readFileSync(tmp)).digest('hex') !== sha256) {
    fs.unlinkSync(tmp)
    throw new Error('语音模型校验失败，请重新下载')
  }
  fs.renameSync(tmp, dest)
}

// 下载所有「未就绪」的模型到 userData/models
async function downloadModels(wc: WebContents): Promise<{ ok: boolean; error?: string }> {
  if (downloading) return { ok: false, error: '正在下载中' }
  downloading = true
  const send = (p: object): void => {
    if (!wc.isDestroyed()) wc.send('stt:downloadProgress', p)
  }
  try {
    const pending = [MODELS.stream, MODELS.sense, MODELS.vad].filter((m) => !readyDir(m))
    if (!pending.length) return { ok: true }
    let received = 0
    for (const spec of pending) {
      const dir = path.join(userModelsRoot(), spec.name)
      fs.mkdirSync(dir, { recursive: true })
      for (const f of spec.files) {
        const dest = path.join(dir, f.file)
        if (fs.existsSync(dest) && (!f.sha256 || createHash('sha256').update(fs.readFileSync(dest)).digest('hex') === f.sha256)) continue
        send({ phase: 'downloading', model: spec.name, file: f.file, received })
        await downloadFile(f.url, dest, (n) => {
          received += n
          send({ phase: 'downloading', model: spec.name, file: f.file, received })
        }, f.sha256)
      }
    }
    // 下完清缓存的加载错误,让下次 ensure 重新建
    loadError = null
    recognizer = null
    workerDead = false
    worker?.terminate()
    worker = null
    send({ phase: 'done', received })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    send({ phase: 'error', error: msg })
    return { ok: false, error: msg }
  } finally {
    downloading = false
  }
}

// 会话态
let stream: unknown = null
let chunks: Float32Array[] = [] // 当前这一句的音频（自动切句后清空）
let committed = ''

// VAD supplies the speech decision; silence duration only determines sentence boundaries.
const SILENCE_MS = 650 // 连续静音多久算「说完一句」（+ 采集/识别耗时 ≈ 用户体感 1s）
const MIN_SPEECH_MS = 400 // 一句至少要有这么多语音，避免咳嗽/键盘声触发
let vadSession: VadSession | null = null
let recordingEpoch = 0
let stoppingRecording = false
type VoiceFinal = {text: string; targetId: string; segmentId: string}
let stoppedFinals: VoiceFinal[] = []
let currentTargetId = ''
let voiceMode: 'standard' | 'strong' | 'basic' = 'standard'
let voiceSegment = 0
const finalJobs = new Set<Promise<void>>()
let recordingOwner: number | null = null
let detachOwner = (): void => {}
const voiceGate = new VoiceGate()
let silentMs = 0
let speechMs = 0
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

// 一句说完：用 SenseVoice 出定稿 → 发给渲染层直接落字；清空缓存继续听下一句。
// 处理发生在「用户已经停下来」的静音里，用户感知不到等待，也不需要任何 loading 态。
async function flushSentence(wc: WebContents): Promise<void> {
  const epoch = recordingEpoch
  const targetId = currentTargetId
  const segmentId = `${epoch}:${++voiceSegment}`
  const audio = concatChunks()
  if (!audio.length) return
  // 同步部分只做「取走音频 + 复位计数」，之后立刻返回；识别在 worker 里跑，主进程不阻塞，
  // 用户可以马上接着说下一句（新音频进新的一批 chunks，worker 内部按序处理，不会串）。
  chunks = []
  const streamFallback = committed + (recognizer && stream ? recognizer.getResult(stream).text.trim() : '')
  committed = ''
  silentMs = 0
  speechMs = 0
  if (recognizer && stream) recognizer.reset(stream)
  if (!wc.isDestroyed()) wc.send('stt:partial', '')
  try {
    const text = (await transcribeAsync(audio)) || streamFallback
    if (text && epoch === recordingEpoch) {
      const deduped = text
      if (deduped) {
        if (stoppingRecording) stoppedFinals.push({text: deduped, targetId, segmentId})
        else if (!wc.isDestroyed()) wc.send('stt:final', deduped, targetId, segmentId)
      }
    }
  } catch (e) {
    console.error('[stt] 自动切句失败', e)
  }
}

export function registerSttHandlers(): void {
  // 模型是否就绪(渲染层点麦克风前先查；缺则引导下载)
  /**
   * 文件转录用：识别一段已经重采样到 16kHz 单声道的音频。
   *
   * 解码放在渲染层做（WebAudio 能吃 mp4/m4a/mp3/wav，是 Chromium 自带的编解码器，
   * 不用引 ffmpeg）；这里只负责把样本喂给已有的 SenseVoice worker。
   * 模型支持 zh/en/ja/ko/yue 且 language:'auto'，参考视频基本都覆盖得到。
   */
  ipcMain.handle('stt:transcribeChunk', async (_e, buf: ArrayBuffer): Promise<string> => {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength > 16000 * 30 * 4 || buf.byteLength % 4) return ''
    const samples = new Float32Array(buf)
    if (!samples.length) return ''
    // 一段最长 30 秒，给 90 秒余量——慢机器上 CPU 解码确实要这么久
    return (await transcribeAsync(samples, 90000)) ?? ''
  })

  ipcMain.handle('stt:modelStatus', (): { ready: boolean; missing: string[] } => {
    const missing = [MODELS.stream, MODELS.sense, MODELS.vad].filter((m) => !readyDir(m)).map((m) => m.name)
    return { ready: missing.length === 0, missing }
  })

  // 首次使用下载模型(带进度事件 stt:downloadProgress)
  ipcMain.handle('stt:downloadModels', (e) => downloadModels(e.sender as WebContents))

  ipcMain.handle('stt:start', async (e, mode: unknown): Promise<{ ok: boolean; error?: string; needDownload?: boolean }> => {
    if (recordingOwner !== null) return { ok: false, error: '已有语音录音，请先停止' }
    voiceMode = mode === 'strong' || mode === 'basic' ? mode : 'standard'
    const epoch = ++recordingEpoch
    recordingOwner = e.sender.id
    const release = (): void => { if (recordingEpoch === epoch) { recordingOwner = null; detachOwner(); detachOwner = () => {} } }
    const destroyed = (): void => {
      if (recordingEpoch !== epoch) return
      release(); recordingEpoch++; (stream as {free?:()=>void} | null)?.free?.(); stream = null; chunks = []; voiceGate.reset()
      vadSession?.stop(); vadSession = null
    }
    e.sender.once('destroyed', destroyed)
    detachOwner = () => e.sender.removeListener('destroyed', destroyed)
    const valid = (): boolean => epoch === recordingEpoch && !e.sender.isDestroyed()
    try {
    if (process.platform === 'darwin') {
      const st = systemPreferences.getMediaAccessStatus('microphone')
      if (st !== 'granted') {
        const ok = await systemPreferences.askForMediaAccess('microphone')
        if (!valid()) return {ok:false,error:'录音初始化已取消'}
        if (!ok) { release(); return { ok: false, error: '麦克风权限被拒绝' } }
      }
    }
    // 流式模型缺失 → 让渲染层去下载(而非报死)
    if (!readyDir(MODELS.stream) || (voiceMode !== 'basic' && !readyDir(MODELS.vad))) { release(); return { ok: false, error: '语音或人声检测模型未下载', needDownload: true } }
    const r = await ensureRecognizer()
    if (!valid()) return {ok:false,error:'录音初始化已取消'}
    if (!r) { release(); return { ok: false, error: loadError ?? '识别器不可用' } }
    try {
      if (voiceMode !== 'basic') {
      const created = await openVoiceVad(path.join(readyDir(MODELS.vad)!, 'silero_vad.onnx'), (samples, speech, targetId) => {
        if (epoch !== recordingEpoch || !stream) return
        routeAudio(e.sender, samples, speech, targetId)
      }, message => {
        if (epoch !== recordingEpoch) return
        release(); (stream as {free?:()=>void} | null)?.free?.(); stream = null; chunks = []; recordingEpoch++
        if (!e.sender.isDestroyed()) e.sender.send('stt:error', message)
      }, voiceMode === 'strong')
      if (!valid()) { created.stop(); return {ok:false,error:'录音初始化已取消'} }
      vadSession = created
      }
    } catch (error) { release(); return { ok: false, error: String(error) } }
    voiceGate.reset()
    stoppingRecording = false; stoppedFinals = []; currentTargetId = ''; voiceSegment = 0
    stream = r.createStream()
    chunks = []
    committed = ''
    silentMs = 0
    speechMs = 0
    return { ok: true }
    } catch (error) { release(); vadSession?.stop(); vadSession = null; return {ok:false,error:String(error)} }
  })

  function routeAudio(wc: WebContents, samples: Float32Array, speech: boolean, targetId: string): void {
        if (targetId !== currentTargetId) {
          if (speechMs >= MIN_SPEECH_MS) {
            const job = flushSentence(wc); finalJobs.add(job); void job.finally(() => finalJobs.delete(job))
          }
          chunks = []; committed = ''; speechMs = 0; silentMs = 0
          voiceGate.reset(); if (recognizer && stream) recognizer.reset(stream)
          currentTargetId = targetId
        }
        if (!targetId) return
        for (const frame of voiceGate.push(samples, speech)) processAudio(wc, frame, speech && frame === samples)
  }

  function processAudio(wc: WebContents, f32: Float32Array, detectedSpeech: boolean): void {
    const r = recognizer
    if (!r || !stream) return
    try {
      const ms = (f32.length / 16000) * 1000
      const loud = detectedSpeech
      // 静音期只在「已经说过话」之后才累积缓存，避免开头的空录音把一句撑长
      chunks.push(f32) // Gate already bounded pre-roll; keep initial consonants in offline audio.
      if (loud) {
        speechMs += ms
        silentMs = 0
      } else if (chunks.length) {
        silentMs += ms
      }
      ;(stream as { acceptWaveform(sr: number, s: Float32Array): void }).acceptWaveform(16000, f32)
      while (r.isReady(stream)) r.decode(stream)
      const seg = r.getResult(stream).text.trim()
      // 说话中：流式预览（灰字），让用户看到在听
      if (r.isEndpoint(stream)) {
        committed = (committed + seg).trim()
        r.reset(stream)
        if (!wc.isDestroyed()) wc.send('stt:partial', committed)
      } else if (!wc.isDestroyed()) {
        wc.send('stt:partial', (committed + seg).trim())
      }
      // 停顿够久且这一句确实有内容 → 就地用 SenseVoice 出定稿并落字（处理藏在静音里，无 loading）
      if ((silentMs >= SILENCE_MS || chunks.length >= 235) && speechMs >= MIN_SPEECH_MS) {
        const job = flushSentence(wc); finalJobs.add(job)
        void job.finally(() => finalJobs.delete(job))
      }
    } catch (err) { console.error('[stt:audio]', err) }
  }
  ipcMain.on('stt:audio', (e, buf: ArrayBuffer, targetId: unknown) => {
    if (typeof targetId !== 'string' || targetId.length > 100) return
    if (stoppingRecording || e.sender.id !== recordingOwner || !stream || !(buf instanceof ArrayBuffer) || buf.byteLength !== 4096) return
    const i16 = new Int16Array(buf)
    const samples = Float32Array.from(i16, n => n / 32768)
    if (voiceMode === 'basic') {
      let energy = 0; for (const sample of samples) energy += sample * sample
      routeAudio(e.sender, samples, Math.sqrt(energy / samples.length) > 0.012, targetId)
    } else vadSession?.push(samples, targetId)
  })

  // 停止录音：只需收尾「最后一句还没到静音阈值就被手动停掉」的残句（已自动落字的不重复）
  ipcMain.handle('stt:stop', async (e): Promise<{ text: string; segments?: VoiceFinal[] }> => {
    if (e.sender.id !== recordingOwner || stoppingRecording) return { text: '' }
    stoppingRecording = true
    const stoppingEpoch = recordingEpoch
    const ownVad = vadSession
    await ownVad?.drain()
    if (stoppingEpoch !== recordingEpoch || e.sender.id !== recordingOwner) return {text:''}
    await Promise.all([...finalJobs])
    if (stoppingEpoch !== recordingEpoch || e.sender.id !== recordingOwner) return {text:''}
    vadSession?.stop(); vadSession = null; voiceGate.reset()
    const flushed = stoppedFinals.slice()
    const tailTarget = currentTargetId
    const tailSegment = `${recordingEpoch}:${++voiceSegment}`
    stoppedFinals = []
    recordingOwner = null; detachOwner(); detachOwner = () => {}
    const epoch = ++recordingEpoch
    const validSpeech = speechMs >= MIN_SPEECH_MS
    const r = recognizer
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
    const all = chunks.length ? concatChunks() : new Float32Array(0)
    const fallback = (committed + streamTail).trim()
    ;(stream as {free?:()=>void} | null)?.free?.()
    stream = null
    chunks = []
    committed = ''
    silentMs = 0
    speechMs = 0
    // 残句太短(多是静音尾巴)就不识别了，免得吐出噪声字；识别同样走 worker，不卡主进程
    const offlineText = validSpeech && all.length / 16000 > 0.3 ? await transcribeAsync(all) : null
    const text = validSpeech && epoch === recordingEpoch ? (offlineText || fallback).trim() : ''
    const deduped = text
    if (deduped && tailTarget) flushed.push({text: deduped, targetId: tailTarget, segmentId: tailSegment})
    return { text: flushed.map(s => s.text).join(''), segments: flushed }
  })
}
