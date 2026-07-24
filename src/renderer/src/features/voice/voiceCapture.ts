// 采麦 → 16kHz 单声道 Int16 PCM → 经 IPC 送主进程的 sherpa STT。
// 用 AudioContext({sampleRate:16000}) 让浏览器直接重采样到 16k(sherpa 要 16k),免手写重采样。
// ScriptProcessorNode 虽已弃用但零依赖、无 worklet 文件/CSP 坑,做语音输入足够。

export class VoiceCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: ScriptProcessorNode | null = null
  private src: MediaStreamAudioSourceNode | null = null

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    // 部分实现不精确支持 16k，退回默认再靠 sherpa 端容忍（此处仍指定，Chromium 支持）
    this.ctx = new AudioContext({ sampleRate: 16000 })
    this.src = this.ctx.createMediaStreamSource(this.stream)
    this.node = this.ctx.createScriptProcessor(2048, 1, 1)
    this.node.onaudioprocess = (ev): void => {
      const f32 = ev.inputBuffer.getChannelData(0)
      const i16 = new Int16Array(f32.length)
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]))
        i16[i] = s < 0 ? s * 32768 : s * 32767
      }
      window.api.stt.sendAudio(i16.buffer)
    }
    this.src.connect(this.node)
    this.node.connect(this.ctx.destination) // ScriptProcessor 需接一个 sink 才会触发 onaudioprocess
  }

  stop(): void {
    try {
      if (this.node) this.node.onaudioprocess = null
      this.node?.disconnect()
      this.src?.disconnect()
      this.stream?.getTracks().forEach((t) => t.stop())
      void this.ctx?.close()
    } catch {
      /* 忽略清理异常 */
    }
    this.node = null
    this.src = null
    this.stream = null
    this.ctx = null
  }
}
