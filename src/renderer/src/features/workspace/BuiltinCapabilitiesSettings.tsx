// 设置页「内置能力」：随包内置、manifest 声明 `system: true` 的插件（电脑视野 / 执行清单…）。
// 它们不列在抽屉「我的插件」里，开关放这里。启用逻辑与抽屉共用同一条 IPC（plugins:setEnabled），不另写。
import { useEffect, useState } from 'react'
import type { PluginInfo } from '../../../../shared/types'
import { systemPlugins } from '../../../../shared/pluginSourceGroups'

export function BuiltinCapabilitiesSettings(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const reload = (): Promise<void> =>
    window.api.plugins.list().then(l => setPlugins(systemPlugins(l))).catch(() => setPlugins([]))
  useEffect(() => { void reload() }, [])
  const toggle = async (p: PluginInfo): Promise<void> => {
    setBusy(p.id)
    setErr(null)
    try {
      await window.api.plugins.setEnabled(p.id, p.enabled === false)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  if (plugins === null) return <div className="cset-sub">读取中…</div>
  if (!plugins.length) return <div className="cset-sub">没有内置能力。</div>
  return (
    <>
      {plugins.map(p => (
        <div key={p.id}>
          <label className="cset-row">
            <input type="checkbox" checked={p.enabled !== false} disabled={busy === p.id} onChange={() => void toggle(p)} />
            <span className="cset-rowname">{p.displayName}</span>
          </label>
          {p.description && <div className="cset-sub">{p.description}</div>}
        </div>
      ))}
      {err && <div className="cset-sub" role="alert">{err}</div>}
      <div className="cset-note">这些是随应用内置的系统能力，不出现在「我的插件」里。关闭后，对应功能与 AI 工具入口一并停用。</div>
    </>
  )
}
