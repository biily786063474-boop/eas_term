// 采麦 → 16kHz 单声道 Int16 PCM → 经 IPC 送主进程的 sherpa STT。
// 用 AudioContext({sampleRate:16000}) 让浏览器直接重采样到 16k(sherpa 要 16k),免手写重采样。
// ScriptProcessorNode 虽已弃用但零依赖、无 worklet 文件/CSP 坑,做语音输入足够。
//
// **能耗要点**：一旦开始采麦，系统就起两条实时音频线程（AudioInputDevice 和
// AudioOutputDevice —— 后者躲不掉，非离线的 AudioContext 本身就由输出设备的时钟驱动，
// 试过把 sink 换成 MediaStreamDestination，输出设备照样开）。这两条线程占的 CPU 时间不多，
// 但会把 CPU 从深睡里反复叫起来：实测一个**泄漏没关的**采麦流让渲染进程攒出 140 万次
// 空闲唤醒、GPU + 渲染进程持续吃掉 60% CPU。录音时这是必要成本，
// 不录音时它就是纯粹的电池杀手 —— 所以下面每一条退出路径都必须真正释放设备，
// 不能只是把引用丢掉。

export class VoiceCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: ScriptProcessorNode | null = null
  private src: MediaStreamAudioSourceNode | null = null

  async start(): Promise<void> {
    // 整段包起来：getUserMedia 一旦成功，麦克风就已经开了。后面任何一步抛错
    // （AudioContext 不支持 16k、createScriptProcessor 失败…）都必须把它关掉再往外扔，
    // 否则那个 MediaStream 就再也没人能碰到了——麦克风永久亮着，谁都不知道为什么。
    try {
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
    } catch (e) {
      this.stop() // 半路失败也要把已经拿到的设备还回去
      throw e
    }
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
