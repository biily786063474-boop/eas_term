// 「更多」抽屉的「插件」页 —— 插件的总控台（设计 2026-09-15）。
//
// 三块：
//   · 已装：所有装了的插件（自家 + Claude / Codex），每个带**开关**。只有开启的才出现在
//     双击的插入面板与输入框 @ 里（关 ≠ 卸载）。自家装的还能卸载。
//   · 发现：官方目录里可一键装的插件，装前弹权限确认（两段式，延续「不静默装」红线）。
//   · 「查看完整插件市场」：进分类 + 搜索的完整商店（骨架阶段先占位，随后填）。
import { useEffect, useState } from 'react'
import type { PluginInfo, PluginRegistryEntry } from '../../../../shared/types'
import { PlusIcon, TrashIcon, RefreshIcon, ChevronRightIcon } from '../../ui/Icons'

/** canvas 权限的人话（白名单只有这四个，见 shared/pluginProtocol.ts）。 */
const PERM_LABEL: Record<string, string> = {
  canvas_open_file: '在画布上打开文件',
  canvas_open_url: '在画布上打开网页',
  canvas_add_note: '在画布上贴便签',
  canvas_focus_node: '定位/聚焦画布上的节点'
}
const fmtSize = (b: number): string =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
const srcLabel = (p: PluginInfo): string =>
  p.cli === 'eas' ? (p.builtin ? '自家 · 内置' : '自家') : p.cli === 'claude' ? 'Claude' : 'Codex'

type Pending = { token: string; name: string; displayName: string; version: string; size: number; permissions: string[] }
type Confirm = { kind: 'install'; data: Pending } | { kind: 'uninstall'; name: string; displayName: string }

export function CanvasMarketPanel(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [reg, setReg] = useState<{ entries: PluginRegistryEntry[]; stale: boolean } | null | 'error'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const reload = (): Promise<void> =>
    window.api.plugins
      .list()
      .then((l) => setPlugins(l))
      .catch(() => setPlugins([]))
  useEffect(() => {
    void reload()
    window.api.plugins
      .registry()
      .then((r) => setReg(r.ok ? { entries: r.entries, stale: r.stale } : 'error'))
      .catch(() => setReg('error'))
  }, [])

  const installedEas = new Set((plugins ?? []).filter((p) => p.cli === 'eas').map((p) => p.name))
  const userEas = new Set((plugins ?? []).filter((p) => p.cli === 'eas' && !p.builtin).map((p) => p.name))
  const enabledCount = (plugins ?? []).filter((p) => p.enabled !== false).length

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
  const startInstall = async (name: string): Promise<void> => {
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.install(name)
      if (!r.ok) setErr(r.error)
      else setConfirm({ kind: 'install', data: r })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const commitInstall = async (): Promise<void> => {
    if (confirm?.kind !== 'install') return
    const { token, name } = confirm.data
    setConfirm(null)
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.installCommit(token)
      if (!r.ok) setErr(r.error)
      else await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const doUninstall = async (): Promise<void> => {
    if (confirm?.kind !== 'uninstall') return
    const { name } = confirm
    setConfirm(null)
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.uninstall(name)
      if (!r.ok) setErr(r.error)
      else await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const kw = q.trim().toLowerCase()
  const installed = (plugins ?? []).filter((p) => !kw || (p.displayName + (p.description ?? '')).toLowerCase().includes(kw))
  const discover =
    reg && reg !== 'error'
      ? reg.entries.filter((e) => !installedEas.has(e.name) && (!kw || (e.displayName + (e.description ?? '')).toLowerCase().includes(kw)))
      : []

  const avatar = (name: string, brand?: string): JSX.Element => (
    <span className="mk-av" style={{ background: (brand ?? '#3a3f4b') + '33', color: brand ?? '#aeb4c0' }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  )

  return (
    <div className="mk-panel">
      <div className="mk-search">
        <span className="mk-mag">⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索插件…" />
      </div>
      {err && <div className="mk-err">{err}</div>}

      {/* ── 已装 ── */}
      <div className="mk-sec">
        已装
        {plugins && (
          <span className="mk-n">
            · {plugins.length} · 开启 {enabledCount}
          </span>
        )}
      </div>
      {plugins === null && <div className="mk-empty">读取中…</div>}
      {plugins && !installed.length && <div className="mk-empty">{kw ? '没找到' : '还没装任何插件，去下面「发现」装一个'}</div>}
      {installed.map((p) => {
        const working = busy === p.id
        const on = p.enabled !== false
        return (
          <div key={p.id} className={`mk-card${on ? '' : ' off'}`}>
            {avatar(p.displayName, p.brandColor)}
            <div className="mk-body">
              <div className="mk-top">
                <span className="mk-name">{p.displayName}</span>
                <span className="mk-src">{srcLabel(p)}</span>
              </div>
              {(p.description || !on) && (
                <div className="mk-desc">{on ? p.description : '已关闭 —— 不在插入面板和 @ 里出现'}</div>
              )}
            </div>
            <div className="mk-act">
              {userEas.has(p.name) && (
                <button
                  className="mk-icon"
                  data-tip="卸载"
                  onClick={() => setConfirm({ kind: 'uninstall', name: p.name, displayName: p.displayName })}
                >
                  <TrashIcon size={12} />
                </button>
              )}
              <button
                className={`mk-sw${on ? ' on' : ''}`}
                role="switch"
                aria-checked={on}
                data-tip={on ? '已开启' : '已关闭'}
                disabled={working}
                onClick={() => toggle(p)}
              />
            </div>
          </div>
        )
      })}

      {/* ── 发现 ── */}
      <div className="mk-sec">
        发现
        {reg && reg !== 'error' && reg.stale && <span className="mk-n warn">· 离线·显示缓存</span>}
      </div>
      {reg === null && <div className="mk-empty">读取目录中…</div>}
      {reg === 'error' && <div className="mk-empty">拉不到插件目录，检查网络后重开这页</div>}
      {reg && reg !== 'error' && !discover.length && <div className="mk-empty">{kw ? '没找到' : '目录里的都装过了'}</div>}
      {discover.map((e) => {
        const working = busy === e.name
        return (
          <div key={e.name} className="mk-card">
            {avatar(e.displayName, e.brandColor)}
            <div className="mk-body">
              <div className="mk-top">
                <span className="mk-name">{e.displayName}</span>
                {e.category && <span className="mk-cat">{e.category}</span>}
              </div>
              {e.description && <div className="mk-desc">{e.description}</div>}
            </div>
            <div className="mk-act">
              {working ? (
                <span className="mk-spin">
                  <RefreshIcon size={12} />
                </span>
              ) : (
                <button className="mk-install" onClick={() => startInstall(e.name)}>
                  <PlusIcon size={11} />
                  安装
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* ── 完整市场入口（骨架先占位）── */}
      <button className="mk-full" onClick={() => setErr('完整插件市场（分类 + 搜索）即将上线')}>
        <span>查看完整插件市场</span>
        <ChevronRightIcon size={14} />
      </button>

      <div className="mk-foot">只有开启的插件会出现在双击的插入面板、和输入框 @ 里。关掉不卸载，随时能开回来。</div>

      {/* ── 确认框（内联在抽屉里）── */}
      {confirm && (
        <div className="cpk-modal-back" onMouseDown={(ev) => ev.stopPropagation()}>
          {confirm.kind === 'install' ? (
            <div className="cpk-modal">
              <div className="cpk-modal-title">安装「{confirm.data.displayName}」</div>
              <div className="cpk-modal-sub">
                v{confirm.data.version} · {fmtSize(confirm.data.size)}
              </div>
              {confirm.data.permissions.length ? (
                <>
                  <div className="cpk-modal-label">装上后它可以：</div>
                  <ul className="cpk-perms">
                    {confirm.data.permissions.map((p) => (
                      <li key={p}>{PERM_LABEL[p] ?? p}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="cpk-modal-label">它不请求任何画布权限。</div>
              )}
              <div className="cpk-modal-acts">
                <button className="cpk-btn ghost" onClick={() => setConfirm(null)}>
                  取消
                </button>
                <button className="cpk-btn primary" onClick={commitInstall}>
                  确认安装
                </button>
              </div>
            </div>
          ) : (
            <div className="cpk-modal">
              <div className="cpk-modal-title">卸载「{confirm.displayName}」</div>
              <div className="cpk-modal-label">删掉 ~/.eas/plugins 里的这个插件目录，随时能再装回来。</div>
              <div className="cpk-modal-acts">
                <button className="cpk-btn ghost" onClick={() => setConfirm(null)}>
                  取消
                </button>
                <button className="cpk-btn danger" onClick={doUninstall}>
                  卸载
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
