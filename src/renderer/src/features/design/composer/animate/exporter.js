/**
 * MotionComposer — export animation as WebM with alpha channel
 * Uses Canvas captureStream + MediaRecorder with VP9 codec.
 *
 * 时序协议(2026-06-02 修):
 *  - MediaRecorder + captureStream(0) 用的是 **wall-clock** 时间戳,文件时长 = recorder.start → recorder.stop 之间的真实经过时间。
 *  - 老实现用 `setTimeout(renderNext, 0)` 让循环跑满浏览器速度,几十毫秒内把 90 帧全推完,
 *    MediaRecorder 录到的是个 < 1s 的超短视频(用户反馈:动画很快)。
 *  - 新实现按 **wall-clock target** 精确等下一帧时间点:
 *      targetMs = startMs + (frame + 1) / fps * 1000
 *      → 等到 now ≥ targetMs 才推下一帧,文件真实时长 ≈ duration。
 *  - 仍用 `captureStream(0)` 手动模式 + `track.requestFrame()` 保证每帧只采一次,不漏不重。
 *  - 注意:不能用 `await new Promise(r => setTimeout(r, 1000/fps))` 累加误差(setTimeout 最小 4ms 节流 +
 *    渲染耗时累积),必须每帧都按 wall-clock target 修正。
 */
import { renderFrame } from './renderer'

export async function exportMotion({ layers, canvasWidth, canvasHeight, backgroundColor, fps, duration, onProgress }) {
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')

  // Try VP9 with alpha, fall back to VP8, then default
  const mimeTypes = [
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm',
  ]
  let mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'

  const safeFps = Math.max(1, Math.min(60, Math.round(fps || 30)))
  const safeDuration = Math.max(0.1, duration || 5)
  const frameIntervalMs = 1000 / safeFps

  const stream = canvas.captureStream(0) // 0 = manual frame capture
  const track = stream.getVideoTracks()[0]
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })

  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  return new Promise((resolve, reject) => {
    recorder.onerror = reject
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      resolve(blob)
    }

    // timeslice 250ms 确保 dataavailable 持续触发,即使浏览器节流也不丢段
    recorder.start(250)

    const totalFrames = Math.ceil(safeFps * safeDuration)
    const startMs = performance.now()

    // 渲染第 0 帧并立即出一帧,让 MediaRecorder 锚定起始时间戳
    renderFrame(ctx, layers, 0, canvasWidth, canvasHeight, backgroundColor)
    if (track?.requestFrame) track.requestFrame()
    if (onProgress) onProgress(1 / totalFrames)

    let frame = 1 // 下一帧编号

    async function tick() {
      try {
        while (frame < totalFrames) {
          // wall-clock target: 第 frame 帧的目标时间 = startMs + frame * frameIntervalMs
          const targetMs = startMs + frame * frameIntervalMs
          const now = performance.now()
          const waitMs = targetMs - now
          if (waitMs > 1) {
            await new Promise((r) => setTimeout(r, waitMs))
          }
          // 渲染当前帧
          const time = frame / safeFps
          renderFrame(ctx, layers, time, canvasWidth, canvasHeight, backgroundColor)
          if (track?.requestFrame) track.requestFrame()
          if (onProgress) onProgress((frame + 1) / totalFrames)
          frame++
        }
        // 最后一帧之后再等满一帧间隔,确保 MediaRecorder 完整录到末帧的展示时长
        const endTargetMs = startMs + totalFrames * frameIntervalMs
        const tailWait = endTargetMs - performance.now()
        if (tailWait > 0) await new Promise((r) => setTimeout(r, tailWait))
        recorder.stop()
      } catch (err) {
        try { recorder.stop() } catch {}
        reject(err)
      }
    }

    tick()
  })
}
