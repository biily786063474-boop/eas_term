/**
 * UnifiedComposer animate — MP4 exporter (2026-06-02)
 *
 * 用 WebCodecs `VideoEncoder` 编 H.264 + `mp4-muxer` 封装 MP4 容器。
 *
 * 与 exporter.js (MediaRecorder + WebM) 的关键差异:
 *  - 输出 MP4 (H.264) 容器,VLC / QuickTime / 浏览器原生 <video> 全兼容
 *  - 帧率严格按 fps 参数精确(每帧 timestamp = i * 1/fps 秒),不受浏览器节流影响
 *  - **不支持 alpha**:MP4 H.264 无透明通道,backgroundColor='transparent' 会被强制改为白底
 *    透明导出请走 exporter.js (exportMotion / WebM VP9)
 *  - 同步 renderFrame:每帧主线程渲染 → VideoFrame → encode,无 captureStream 不确定性
 *
 * 兼容性:Electron 36 Chromium ≥ 124 完全支持 VideoEncoder + avc1.42E01F (H.264 Baseline)
 *
 * 入参与 exportMotion 一致:layers / canvasWidth / canvasHeight / backgroundColor / fps / duration / onProgress
 * 出参:Blob ({ type: 'video/mp4' })
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { renderFrame } from './renderer'

export async function exportMotionMp4({ layers, canvasWidth, canvasHeight, backgroundColor, fps, duration, onProgress }) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('当前环境不支持 WebCodecs VideoEncoder,无法导出 MP4。请用"导出预合成"输出 WebM。')
  }

  const safeFps = Math.max(1, Math.min(60, Math.round(fps || 30)))
  const safeDuration = Math.max(0.1, duration || 5)
  // MP4 不支持 alpha,透明底强制改白底,避免输出黑屏 / 编码失败
  const bg = (!backgroundColor || backgroundColor === 'transparent') ? '#ffffff' : backgroundColor

  // H.264 偶数尺寸要求(yuv420p):任何奇数维度向下取偶
  const width = canvasWidth - (canvasWidth % 2)
  const height = canvasHeight - (canvasHeight % 2)

  // 离屏 canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })

  // muxer
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: safeFps,
    },
    fastStart: 'in-memory',
  })

  // 选 codec config(级别按分辨率算):
  // 1080p30: avc1.640028 (High@4.0) / 720p30: avc1.640020 (High@3.2) / 兜底 Baseline 3.1
  // 简化:统一 High Profile Level 4.0,兼容 ≤ 1080p60
  const codecString = 'avc1.640028'
  const bitrate = pickBitrate(width, height, safeFps)

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw new Error(`VideoEncoder error: ${e.message || e}`) },
  })

  encoder.configure({
    codec: codecString,
    width,
    height,
    bitrate,
    framerate: safeFps,
    // Chrome 要求 Baseline 才能去 avcc,High Profile 默认 avcc(mp4-muxer 兼容)
  })

  const totalFrames = Math.ceil(safeFps * safeDuration)
  // 关键帧间隔 ~2 秒,长片也能拖动播放
  const keyframeInterval = Math.max(1, safeFps * 2)

  for (let i = 0; i < totalFrames; i++) {
    const time = i / safeFps // 秒
    renderFrame(ctx, layers, time, width, height, bg)

    // VideoFrame: timestamp 用微秒,duration 1 帧
    const timestampUs = Math.round((i * 1_000_000) / safeFps)
    const frameDurationUs = Math.round(1_000_000 / safeFps)
    const videoFrame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: frameDurationUs,
    })

    const keyFrame = (i % keyframeInterval === 0)
    encoder.encode(videoFrame, { keyFrame })
    videoFrame.close()

    if (onProgress) onProgress((i + 1) / totalFrames)

    // 每 30 帧让出一次,防 UI 完全卡死;encoder.encode 内部 microtask 排队
    if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0))
  }

  await encoder.flush()
  encoder.close()
  muxer.finalize()

  const { buffer } = muxer.target
  return new Blob([buffer], { type: 'video/mp4' })
}

// 经验值码率:1080p≈8M / 720p≈4M / 4K≈20M;线性 px·fps
function pickBitrate(width, height, fps) {
  const pixels = width * height
  // 1080p30 基准 8 Mbps,按像素×帧率线性缩放
  const base = (pixels * fps) / (1920 * 1080 * 30)
  return Math.round(Math.max(1_000_000, Math.min(20_000_000, base * 8_000_000)))
}
