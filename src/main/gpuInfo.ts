// GPU 加速到底有没有生效。**分发侧的排障刚需，不是好奇。**
//
// ── 为什么要有它（2026-08-30）────────────────────────────────────
// 用户报「Windows 上几乎很卡，涉及终端就卡，会卡死未响应」。
// 我在 macOS 上量过毛玻璃的开销，结论是「不是瓶颈」—— 但那个结论**只对 mac 成立**：
// Windows 的合成栈不一样，而且 Electron 在某些显卡/驱动上会**整个退回软件合成**。
// 一旦退回软件合成，`blur(28px) saturate(160%)` 这种大面积 backdrop-filter
// 会变成灾难级开销，而终端又是 canvas —— 正好是最坏组合。
//
// 问题是我在 mac 上**没法测 Windows**，猜一轮改一轮很浪费用户的时间。
// 这个模块的用途就是把「猜」换成「读一个数」：用户打开设置里那一栏，
// 把结果发给我，是不是软件合成一眼就看出来了。
//
// **不做上报、不联网** —— 只在本机显示，用户自己决定要不要发出来。
import { app, ipcMain } from 'electron'
import os from 'os'

import type { GpuInfo } from '../shared/types'


/**
 * **判据是 gpu_compositing 这一项**，不是「有没有显卡」。
 *
 * Chromium 会把每一项报成 `enabled` / `software only` / `disabled` 等等。
 * 只要合成是 software，页面上所有 backdrop-filter、圆角、阴影都由 CPU 画 ——
 * 那时候界面卡不卡跟显卡好不好没关系。
 */
export function readGpuInfo(): GpuInfo {
  let features: Record<string, string> = {}
  try {
    features = app.getGPUFeatureStatus() as unknown as Record<string, string>
  } catch {
    /* 某些平台/时机拿不到，按 unknown 处理 */
  }
  const comp = features.gpu_compositing ?? ''
  const verdict: GpuInfo['verdict'] = /^enabled/.test(comp)
    ? 'gpu'
    : /software|disabled/.test(comp)
      ? 'software'
      : 'unknown'
  return {
    features,
    verdict,
    platform: process.platform,
    release: os.release(),
    arch: process.arch
  }
}

export function registerGpuInfo(): void {
  ipcMain.handle('app:gpuInfo', () => readGpuInfo())
}
