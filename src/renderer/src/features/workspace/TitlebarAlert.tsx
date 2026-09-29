// 标题栏唯一的运行态提示：**有事才出现，没事不渲染**（和 UpdateBadge 同一模式）。
//   · 等待 N     —— 调度器里有任务排队（终端 / AI 启动被资源准入挡住）。点开设置 › 运行与资源。
//                   模块本身还不显示排队态，这是用户唯一能知道「为什么点了没反应」的地方（用户 2026-09-14 拍板）。
//   · MCP 已拒 N —— MCP 接入关着，却仍有调用进来被拒。点开设置 › MCP 接入；打开过即清零。
// 2026-09-14 起标题栏不再常驻「MCP」灯与「运行 N」按钮：排队数改由主进程推送（runtime:waiting），这里不轮询。
import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { useT } from '../../i18n.ts'

export function TitlebarAlert(): JSX.Element | null {
  const tr = useT()
  const [queued, setQueued] = useState(0)
  useEffect(() => {
    let alive = true
    void window.api.runtimeWaiting().then((r) => { if (alive) setQueued(r.queued) }).catch(() => { /* 读不到就当 0 */ })
    const off = window.api.onRuntimeWaiting(({ queued: n }) => setQueued(n))
    return () => { alive = false; off() }
  }, [])
  const mcpEnabled = useStore((s) => s.mcpEnabled)
  const mcpLog = useStore((s) => s.mcpLog)
  const [seenMcpId, setSeenMcpId] = useState(0)
  const rejected = mcpEnabled ? 0 : mcpLog.filter((e) => !e.ok && e.id > seenMcpId).length

  if (!queued && !rejected) return null
  return (
    <>
      {queued > 0 && (
        <button
          type="button"
          className="tb-item tb-alert"
          data-tip={tr('settings.alert.queuedTip')}
          onClick={() => window.dispatchEvent(new CustomEvent('eas:open-settings', { detail: { tab: 'runtime' } }))}
        >
          {tr('settings.alert.queued', { n: queued })}
        </button>
      )}
      {rejected > 0 && (
        <button
          type="button"
          className="tb-item tb-alert"
          data-tip={tr('settings.alert.mcpTip')}
          onClick={() => {
            setSeenMcpId(mcpLog[0]?.id ?? 0)
            window.dispatchEvent(new CustomEvent('eas:open-settings', { detail: { tab: 'mcp' } }))
          }}
        >
          {tr('settings.alert.mcpRejected', { n: rejected })}
        </button>
      )}
    </>
  )
}
