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

import type { GpuInfo } from '../../../../shared/types'

/** 只列跟「界面卡不卡」直接相关的几项。**全列反而没人看** ——
 *  Chromium 报十几项，其中大半（video_decode、webgl2…）跟这个软件的卡顿无关 */
const KEYS: { k: string; label: string; why: string }[] = [
  { k: 'gpu_compositing', label: '图形合成', why: '**最要紧的一项**。它退成软件的话，毛玻璃/圆角/阴影全由 CPU 画' },
  { k: 'rasterization', label: '栅格化', why: '把矢量画成像素这一步谁来做' },
  { k: '2d_canvas', label: '2D 画布', why: '终端正文是画在 canvas 上的，这项掉了终端会明显变慢' }
]

export function GpuPanel(): JSX.Element {
  const [info, setInfo] = useState<GpuInfo | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void window.api.gpuInfo().then(setInfo)
  }, [])

  if (!info) return <div className="cset-note">正在读取…</div>

  const bad = info.verdict === 'software'
  const copy = (): void => {
    void window.api.clipboard.writeText(
      `Eas-Term 图形诊断\n平台 ${info.platform} ${info.release} ${info.arch}\n结论 ${info.verdict}\n` +
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
          ? '图形加速正常 —— 界面渲染走显卡'
          : info.verdict === 'software'
            ? '正在用软件合成 —— 界面渲染全靠 CPU，卡顿多半来自这里'
            : '读不到图形加速状态'}
      </div>
      <div className="cset-note">
        {bald(info)}
      </div>
      <table className="gpu-table">
        <tbody>
          {KEYS.map(({ k, label, why }) => {
            const v = info.features[k] ?? '（没报这一项）'
            const ok = /^enabled/.test(v)
            return (
              <tr key={k}>
                <td className="gpu-k">{label}</td>
                <td className={`gpu-v${ok ? ' ok' : ' bad'}`}>{v}</td>
                <td className="gpu-w">{why.replace(/\*\*/g, '')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button type="button" className="cset-btn" onClick={copy}>
        {copied ? '已复制' : '复制完整诊断'}
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
