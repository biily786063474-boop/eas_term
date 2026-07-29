// 视频/音频 → 文本。**零新依赖、零 token、全离线。**
//
// 解码走 WebAudio：Chromium 自带 mp4 / m4a / mp3 / wav / webm 的解码器，
// 不用引 ffmpeg。重采样到 16kHz 单声道后喂给主进程里已有的 SenseVoice 模型
// （本来是给语音输入用的，支持 zh/en/ja/ko/yue，language:'auto'）。
//
// 为什么要切段：SenseVoice 是**离线整句**识别器，不是流式的。
// 把半小时音频当一句喂进去，既慢又会丢内容。按静音切成 20–30 秒的段，
// 每段单独识别再拼起来，才是它设计上被用对的方式。

const TARGET_SR = 16000
/** 一段的目标长度：太短会把句子切碎，太长超出模型的舒适区 */
const SEG_MAX = 30 * TARGET_SR
const SEG_MIN = 8 * TARGET_SR
/** 静音判据：20ms 一帧算 RMS，连续 300ms 低于阈值就算一个可切点 */
const FRAME = Math.round(0.02 * TARGET_SR)
const SILENCE_RMS = 0.012
const SILENCE_RUN = 15 // 15 帧 = 300ms

export interface TranscribeProgress {
  /** 已完成的段数 / 总段数 */
  done: number
  total: number
  /** 到目前为止的文本 */
  text: string
}

/** 解码 + 重采样到 16kHz 单声道。整段音频一次性进内存——半小时约 115MB，可接受 */
async function decodeTo16k(bytes: ArrayBuffer): Promise<Float32Array> {
  // 用一个临时 AudioContext 解码：decodeAudioData 需要一个 context，采样率无所谓
  const tmp = new AudioContext()
  let buf: AudioBuffer
  try {
    buf = await tmp.decodeAudioData(bytes)
  } finally {
    void tmp.close()
  }
  // OfflineAudioContext 做重采样 + 混成单声道，比手写线性插值准
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * TARGET_SR), TARGET_SR)
  const src = off.createBufferSource()
  src.buffer = buf
  src.connect(off.destination)
  src.start()
  const out = await off.startRendering()
  return out.getChannelData(0).slice()
}

/** 按静音找切点，切成 [start,end) 段 */
function segment(pcm: Float32Array): [number, number][] {
  const segs: [number, number][] = []
  let start = 0
  let quiet = 0
  for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
    let sum = 0
    for (let j = 0; j < FRAME; j++) sum += pcm[i + j] * pcm[i + j]
    const rms = Math.sqrt(sum / FRAME)
    quiet = rms < SILENCE_RMS ? quiet + 1 : 0
    const len = i + FRAME - start
    // 够长了、又正好在静音里 → 切；或者已经太长，强行切（宁可切碎也别喂超长段）
    if ((len >= SEG_MIN && quiet >= SILENCE_RUN) || len >= SEG_MAX) {
      segs.push([start, i + FRAME])
      start = i + FRAME
      quiet = 0
    }
  }
  if (pcm.length - start > TARGET_SR * 0.5) segs.push([start, pcm.length])
  return segs.length ? segs : [[0, pcm.length]]
}

/** 秒 → mm:ss，逐字稿里给时间戳，回头能对着原片找 */
function stamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 转录一个媒体文件，返回带时间戳的逐字稿。
 * onProgress 每完成一段回调一次——半小时的视频要跑几分钟，进度必须看得见。
 */
export async function transcribeFile(
  path: string,
  onProgress?: (p: TranscribeProgress) => void
): Promise<{ ok: boolean; text: string; error?: string }> {
  let pcm: Float32Array
  try {
    const r = await window.api.fs.readBinary(path)
    if (!r.ok) return { ok: false, text: '', error: r.error ?? '读不出文件' }
    pcm = await decodeTo16k(r.data)
  } catch (e) {
    // 最常见的失败是「这个容器里根本没有音轨」或格式不支持
    return { ok: false, text: '', error: '解不出音频：' + (e instanceof Error ? e.message : String(e)) }
  }
  const segs = segment(pcm)
  const lines: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i]
    // 复制一份传过去：postMessage 会把 buffer 转移走，切片共享同一块内存会出事
    const chunk = pcm.slice(a, b)
    const text = await window.api.stt.transcribeChunk(chunk.buffer as ArrayBuffer)
    if (text.trim()) lines.push(`[${stamp(a / TARGET_SR)}] ${text.trim()}`)
    onProgress?.({ done: i + 1, total: segs.length, text: lines.join('\n') })
  }
  return { ok: true, text: lines.join('\n') }
}
