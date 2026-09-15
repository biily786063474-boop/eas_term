// 插件市场的「发现」区：拉官方目录、卡片式列出可装插件、一键安装（先弹权限确认再落盘）。
// 设计稿 docs/superpowers/specs/2026-09-15-插件市场-第一步-design.md（任务 6）。
//
// 两段式安装（延续「不静默装」红线）：
//   点「安装」→ 主进程下载/校验/解压到临时目录，返回**待确认权限 + 一次性 token**
//   → 这里弹确认框展示权限 → 用户确认后带 token 调 installCommit 才真正落盘。
//
// 确认框故意**内联渲染在 picker 里**（不另开 portal）：picker 根节点 onMouseDown 已
// stopPropagation，挡住了 useDismiss 挂在 window 上的「点外部即关」——弹窗若跑到 picker
// DOM 之外，点它自己会把整个 picker 关掉。position: fixed 让它铺满视口居中，不受列表裁剪。
import { useEffect, useState } from 'react'
import type { PluginInfo, PluginRegistryEntry } from '../../../../shared/types'
import { PlusIcon, CheckIcon, TrashIcon, RefreshIcon } from '../../ui/Icons'

/** canvas 权限的人话（白名单只有这四个，见 shared/pluginProtocol.ts）。 */
const PERM_LABEL: Record<string, string> = {
  canvas_open_file: '在画布上打开文件',
  canvas_open_url: '在画布上打开网页',
  canvas_add_note: '在画布上贴便签',
  canvas_focus_node: '定位/聚焦画布上的节点'
}
const fmtSize = (b: number): string =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

type Pending = {
  token: string
  name: string
  displayName: string
  version: string
  size: number
  permissions: string[]
  installed: boolean
}
type Confirm = { kind: 'install'; data: Pending } | { kind: 'uninstall'; name: string; displayName: string }

export function PluginDiscover({
  installed,
  onChanged
}: {
  /** 已装插件全表（父组件已拉好），用来给条目标「已安装」并决定能否卸载 */
  installed: PluginInfo[]
  /** 装/卸成功后回调父组件重扫已装列表 */
  onChanged: () => void
}): JSX.Element {
  const [reg, setReg] = useState<{ entries: PluginRegistryEntry[]; stale: boolean } | null | 'error'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setReg(null)
    window.api.plugins
      .registry()
      .then((r) => {
        if (!alive) return
        setReg(r.ok ? { entries: r.entries, stale: r.stale } : 'error')
      })
      .catch(() => alive && setReg('error'))
    return () => {
      alive = false
    }
  }, [])

  // 自家插件里哪些已装 / 哪些是用户装的（内置样板不可从这卸）
  const installedNames = new Set(installed.filter((p) => p.cli === 'eas').map((p) => p.name))
  const userNames = new Set(installed.filter((p) => p.cli === 'eas' && !p.builtin).map((p) => p.name))

  const startInstall = async (name: string): Promise<void> => {
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.install(name)
      if (!r.ok) {
        setErr(r.error)
        return
      }
      setConfirm({ kind: 'install', data: r })
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
      else onChanged()
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
      else onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="cpk-market">
      <div className="cpk-sec">
        发现
        {reg && reg !== 'error' && reg.stale && <span className="cpk-sec-note">离线·显示缓存</span>}
      </div>

      {reg === null && <div className="cpk-empty">读取目录中…</div>}
      {reg === 'error' && <div className="cpk-empty">拉不到插件目录，检查网络后重开这个 tab</div>}
      {err && <div className="cpk-market-err">{err}</div>}

      {reg && reg !== 'error' &&
        reg.entries.map((e) => {
          const isInstalled = installedNames.has(e.name)
          const canRemove = userNames.has(e.name)
          const working = busy === e.name
          return (
            <div key={e.name} className="cpk-card">
              <span className="cpk-card-dot" style={{ background: e.brandColor ?? '#525252' }} aria-hidden="true" />
              <div className="cpk-card-main">
                <div className="cpk-card-top">
                  <span className="cpk-card-title">{e.displayName}</span>
                  {e.category && <span className="cpk-card-cat">{e.category}</span>}
                </div>
                {e.description && <div className="cpk-card-desc">{e.description}</div>}
              </div>
              <div className="cpk-card-act">
                {working ? (
                  <span className="cpk-card-badge busy">
                    <RefreshIcon size={11} />
                  </span>
                ) : isInstalled ? (
                  canRemove ? (
                    <button
                      className="cpk-card-btn ghost"
                      data-tip="卸载（只删 ~/.eas/plugins 里的这个）"
                      onClick={() => setConfirm({ kind: 'uninstall', name: e.name, displayName: e.displayName })}
                    >
                      <TrashIcon size={11} />
                    </button>
                  ) : (
                    <span className="cpk-card-badge">
                      <CheckIcon size={11} />
                      内置
                    </span>
                  )
                ) : (
                  <button className="cpk-card-btn primary" onClick={() => startInstall(e.name)}>
                    <PlusIcon size={11} />
                    安装
                  </button>
                )}
              </div>
            </div>
          )
        })}

      {reg && reg !== 'error' && !reg.entries.length && <div className="cpk-empty">目录里还没有插件</div>}

      {/* ── 确认框（内联，见文件头注释）─────────────────────────────── */}
      {confirm && (
        <div className="cpk-modal-back" onMouseDown={(ev) => ev.stopPropagation()}>
          {confirm.kind === 'install' ? (
            <div className="cpk-modal">
              <div className="cpk-modal-title">安装「{confirm.data.displayName}」</div>
              <div className="cpk-modal-sub">
                v{confirm.data.version} · {fmtSize(confirm.data.size)}
                {confirm.data.installed && ' · 已装，将覆盖'}
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
