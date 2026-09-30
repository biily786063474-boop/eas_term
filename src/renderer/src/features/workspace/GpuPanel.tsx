// 设置里的「性能」一栏：这台机器的图形加速到底有没有生效。
//
// ── 为什么要给用户看这个（2026-08-30）──────────────────────────────
// 用户报「Windows 上几乎很卡、会卡死未响应」。我在 macOS 上没法复现，
// 而**这一个数就能把猜的范围砍掉一大半**：Electron 在某些显卡/驱动上会整个
// 退回软件合成，那时候页面上所有毛玻璃、圆角、阴影都由 CPU 画 ——
// 界面卡不卡跟显卡好不好没关系，跟这一项有没有 enabled 有关系。
//
// **不上报、不联网。** 只在本机显示，要不要发给我由用户自己决定，
// 所以给了一个「复制」按钮。
import { useEffect, useState } from 'react'

import { useT } from '../../i18n.ts'
import type { GpuInfo } from '../../../../shared/types'

/** 只列跟「界面卡不卡」直接相关的几项。**全列反而没人看** ——
 *  Chromium 报十几项，其中大半（video_decode、webgl2…）跟这个软件的卡顿无关 */
const KEYS = [
  { k: 'gpu_compositing', label: 'settings.gpu.compositing', why: 'settings.gpu.compositingWhy' },
  { k: 'rasterization', label: 'settings.gpu.raster', why: 'settings.gpu.rasterWhy' },
  { k: '2d_canvas', label: 'settings.gpu.canvas2d', why: 'settings.gpu.canvas2dWhy' }
] as const

export function GpuPanel(): JSX.Element {
  const tr = useT()
  const [info, setInfo] = useState<GpuInfo | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void window.api.gpuInfo().then(setInfo)
  }, [])

  if (!info) return <div className="cset-note">{tr('settings.gpu.reading')}</div>

  const bad = info.verdict === 'software'
  const copy = (): void => {
    void window.api.clipboard.writeText(
      `Eas-Term 图形诊断\n平台 ${info.platform} ${info.release} ${info.arch}\n结论 ${info.verdict}\n` + // i18n-allow: 复制给开发者排障的诊断文本，保持中文
        Object.entries(info.features)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
    )
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <div className={`gpu-verdict${bad ? ' bad' : ''}`}>
        {info.verdict === 'gpu'
          ? tr('settings.gpu.ok')
          : info.verdict === 'software'
            ? tr('settings.gpu.software')
            : tr('settings.gpu.unknown')}
      </div>
      <div className="cset-note">
        {bald(info)}
      </div>
      <table className="gpu-table">
        <tbody>
          {KEYS.map(({ k, label, why }) => {
            const v = info.features[k] ?? tr('settings.gpu.notReported')
            const ok = /^enabled/.test(v)
            return (
              <tr key={k}>
                <td className="gpu-k">{tr(label)}</td>
                <td className={`gpu-v${ok ? ' ok' : ' bad'}`}>{v}</td>
                <td className="gpu-w">{tr(why)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button type="button" className="cset-btn" onClick={copy}>
        {copied ? tr('settings.gpu.copied') : tr('settings.gpu.copy')}
      </button>
    </>
  )
}

/** 一句话说清这台机器是什么情况。**平台写出来** —— 排障时第一个要问的就是这个 */
function bald(info: GpuInfo): string {
  const name =
    info.platform === 'win32' ? 'Windows' : info.platform === 'darwin' ? 'macOS' : info.platform
  return `${name} ${info.release} · ${info.arch}`
}
