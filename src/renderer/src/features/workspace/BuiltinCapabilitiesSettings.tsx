// 设置页「内置插件」（设置 → MCP 接入；2026-09-30 由「内置能力」改名）：随包内置、manifest 声明 `system: true` 的插件（电脑视野 / 执行清单…）。同页上方「核心连接」是 BuiltinCapabilitiesCard（随包三模块，另一套机制），两者不合并。
// 它们不列在抽屉「我的插件」里，开关放这里。启用逻辑与抽屉共用同一条 IPC（plugins:setEnabled），不另写。
import { useEffect, useState } from 'react'
import type { PluginInfo } from '../../../../shared/types'
import { systemPlugins } from '../../../../shared/pluginSourceGroups'
import { useT } from '../../i18n.ts'

export function BuiltinCapabilitiesSettings(): JSX.Element {
  const tr = useT()
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
  if (plugins === null) return <div className="cset-sub">{tr('settings.builtinCaps.loading')}</div>
  if (!plugins.length) return <div className="cset-sub">{tr('settings.builtinCaps.empty')}</div>
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
      <div className="cset-note">{tr('settings.builtinCaps.note')}</div>
    </>
  )
}
