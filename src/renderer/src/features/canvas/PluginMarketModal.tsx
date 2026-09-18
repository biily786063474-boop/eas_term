import { PluginConfigurationControls } from './PluginConfigurationControls'
import { canUpdatePlugin } from '../../../../shared/pluginUpdate'
// 完整插件市场弹窗（「更多 › 插件」页点「查看完整插件市场」进来）。
// 左边智能分类、顶部搜索、卡片用真实品牌 logo + 名字 + 简介 + 安装。设计稿
// docs/prototype/2026-09-15-plugin-market-full.html。数据来自 registry（可装）+ 已装列表。
import { PluginAccountControls } from './PluginAccountControls'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PluginInfo, PluginRegistryEntry, PluginUnavailableEntry } from '../../../../shared/types'
import { MARKET_CATEGORIES, categoryIdOf } from '../../../../shared/pluginCategories'
import { PluginLogo } from './pluginLogos'
import { CategoryIcon } from './pluginCategoryIcons'
import { PlusIcon, CheckIcon, RefreshIcon, CloseIcon } from '../../ui/Icons'

const PERM_LABEL: Record<string, string> = {
  canvas_open_file: '在画布上打开文件',
  canvas_open_url: '在画布上打开网页',
  canvas_add_note: '在画布上贴便签',
  canvas_focus_node: '定位/聚焦画布上的节点'
}
const fmtSize = (b: number): string =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

type Item = {
  name: string
  displayName: string
  description?: string
  brandColor?: string
  catId: string
  reason?: string
  installed: boolean
  reg?: PluginRegistryEntry
  cli?: string
  plugin?: PluginInfo
}
type Pending = { token: string; name: string; displayName: string; version: string; size: number; permissions: string[]; installed: boolean; permissionChanges?: {added:string[];removed:string[]}|null }

export function PluginMarketModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [reg, setReg] = useState<{ entries: PluginRegistryEntry[]; unavailable: PluginUnavailableEntry[]; stale:boolean } | null | 'error'>(null)
  const [active, setActive] = useState<string>('featured')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Pending | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reload = (): Promise<void> =>
    window.api.plugins
      .list()
      .then((l) => setPlugins(l))
      .catch(() => setPlugins([]))
  const refreshRegistry = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await reload()
      const r = await window.api.plugins.registry()
      setReg(r.ok ? { entries:r.entries, unavailable:r.unavailable??[], stale:r.stale } : 'error')
    } catch { setReg('error') }
    finally { setRefreshing(false) }
  }
  useEffect(() => {
    void refreshRegistry()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── 合并 registry（可装）+ 已装，成统一条目，按名去重 ──
  const items: Item[] = (() => {
    const map = new Map<string, Item>()
    const installedEas = new Set((plugins ?? []).filter((p) => p.cli === 'eas').map((p) => p.name))
    if (reg && reg !== 'error') {
      for(const e of reg.unavailable){
        map.set(e.name,{name:e.name,displayName:e.displayName,description:e.description,brandColor:e.brandColor,catId:categoryIdOf(e.category),installed:installedEas.has(e.name),reason:e.reason})
      }
      for (const e of reg.entries) {
        map.set(e.name, {
          name: e.name,
          displayName: e.displayName,
          description: e.description,
          brandColor: e.brandColor,
          catId: categoryIdOf(e.category),
          installed: installedEas.has(e.name),
          reg: e
        })
      }
    }
    for (const p of plugins ?? []) {
      if (p.cli === 'eas' && map.has(p.name)) {
        map.get(p.name)!.installed = true
        map.get(p.name)!.plugin = p
        continue
      }
      map.set(p.cli === 'eas' ? p.name : p.id, {
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        brandColor: p.brandColor,
        catId: categoryIdOf(p.category),
        installed: true,
        plugin: p,
        cli: p.cli
      })
    }
    return [...map.values()]
  })()

  const kw = q.trim().toLowerCase()
  const catCount = (id: string): number => items.filter((it) => it.catId === id).length

  const startInstall = async (name: string): Promise<void> => {
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.install(name)
      if (!r.ok) setErr(r.error)
      else setConfirm(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const commitInstall = async (): Promise<void> => {
    if (!confirm) return
    const { token, name } = confirm
    setConfirm(null)
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.installCommit(token)
      if (!r.ok) setErr(r.error)
      else {
        await reload()
        onChanged()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const card = (it: Item): JSX.Element => {
    const working = busy === it.name
    const update = !!it.plugin && !!it.reg && canUpdatePlugin(it.plugin,it.reg.version)
    return (
      <div key={it.plugin?.id ?? it.name} className="pm-card">
        <PluginLogo name={it.name} brandColor={it.brandColor} />
        <div className="pm-cb">
          <div className="pm-ct">
            <b>{it.displayName}</b>
            {it.cli && it.cli !== 'eas' && <span className="pm-src">{it.cli === 'claude' ? 'Claude' : 'Codex'}</span>}
          </div>
          {it.description && <div className="pm-cd">{it.description}</div>}
          {it.plugin?.version && <div className="pm-cd">已安装 v{it.plugin.version}{update ? ` · 可更新至 v${it.reg!.version}` : ''}{it.plugin.builtin ? ' · 随软件更新' : ''}</div>}
          {it.reason && <div className="pm-cd" title={it.reason}>未开放接入 · {it.reason}</div>}
        </div>
        <div className="pm-cact">
          {it.plugin?.config&&<PluginConfigurationControls plugin={it.plugin}/>}
          {it.plugin?.remote?.auth==='oauth'&&<PluginAccountControls id={it.plugin.id} title={it.displayName} enabled={it.plugin.enabled!==false}/>}
          {working ? (
            <span className="pm-spin"><RefreshIcon size={13} /></span>
          ) : update ? (
            <button className="pm-add" title={`更新到 ${it.reg!.version}`} aria-label={`更新${it.displayName}到${it.reg!.version}`} disabled={!!busy || !!confirm || refreshing} onClick={() => startInstall(it.name)}>
              <RefreshIcon size={16} />
            </button>
          ) : it.installed ? (
            <span className="pm-done" title="已安装"><CheckIcon size={15} /></span>
          ) : it.reg ? (
            <button className="pm-add" title="接入" disabled={!!busy || !!confirm || refreshing} onClick={() => startInstall(it.name)}>
              <PlusIcon size={16} />
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  // ── 主区渲染 ──
  let body: JSX.Element
  if (plugins === null || reg === null) {
    body = <div className="pm-empty">读取中…</div>
  } else if (kw) {
    const hits = items.filter((it) => (it.displayName + (it.description ?? '')).toLowerCase().includes(kw))
    body = (
      <>
        <div className="pm-sech">
          搜索「{q}」<span className="pm-n">· {hits.length} 个</span>
        </div>
        {hits.length ? <div className="pm-grid">{hits.map(card)}</div> : <div className="pm-empty">没找到，换个词试试</div>}
      </>
    )
  } else if (active === 'featured') {
    body = (
      <>
        {MARKET_CATEGORIES.filter((c) => catCount(c.id)).map((c) => (
          <div key={c.id}>
            <div className="pm-sech">
              <CategoryIcon id={c.id} size={15} /> {c.name}
            </div>
            <div className="pm-grid">{items.filter((it) => it.catId === c.id).map(card)}</div>
          </div>
        ))}
        {!items.length && <div className="pm-empty">目录还在筹备中</div>}
      </>
    )
  } else if (active === 'installed') {
    const list = items.filter((it) => it.installed)
    body = (
      <>
        <div className="pm-sech">
          已安装 <span className="pm-n">· {list.length} 个</span>
        </div>
        {list.length ? <div className="pm-grid">{list.map(card)}</div> : <div className="pm-empty">还没装任何插件</div>}
      </>
    )
  } else {
    const c = MARKET_CATEGORIES.find((x) => x.id === active)
    const list = items.filter((it) => it.catId === active)
    body = (
      <>
        <div className="pm-sech">
          {c && <CategoryIcon id={c.id} size={15} />} {c?.name} <span className="pm-n">· {list.length} 个</span>
        </div>
        {list.length ? <div className="pm-grid">{list.map(card)}</div> : <div className="pm-empty">这个分类还没有插件</div>}
      </>
    )
  }

  return createPortal(
    <div className="pm-back" onMouseDown={onClose}>
      <div className="pm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pm-side">
          <h1 className="pm-title">插件市场</h1>
          <p className="pm-sub">在你常用的工具里用上 AI</p>
          <nav className="pm-nav">
            <div className="pm-navg">浏览</div>
            <button className={`pm-navb${active === 'featured' ? ' on' : ''}`} onClick={() => setActive('featured')}>
              <span className="pm-ci">
                <CategoryIcon id="featured" />
              </span>
              <span className="pm-cn">精选</span>
              <span className="pm-cc">{items.length}</span>
            </button>
            <button className={`pm-navb${active === 'installed' ? ' on' : ''}`} onClick={() => setActive('installed')}>
              <span className="pm-ci">
                <CategoryIcon id="installed" />
              </span>
              <span className="pm-cn">已安装</span>
              <span className="pm-cc">{items.filter((it) => it.installed).length}</span>
            </button>
            <div className="pm-navg">分类</div>
            {MARKET_CATEGORIES.map((c) => (
              <button key={c.id} className={`pm-navb${active === c.id ? ' on' : ''}`} onClick={() => setActive(c.id)}>
                <span className="pm-ci">
                  <CategoryIcon id={c.id} />
                </span>
                <span className="pm-cn">{c.name}</span>
                <span className="pm-cc">{catCount(c.id)}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="pm-main">
          <div className="pm-head">
            <div className="pm-search">
              <span className="pm-mag">⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索插件…（Word、地图、GitHub…）" autoFocus />
            </div>
            <button className="pm-close" title="刷新目录" aria-label="刷新目录" disabled={refreshing || !!busy || !!confirm} onClick={() => void refreshRegistry()}>
              <RefreshIcon size={16} />
            </button>
            <button className="pm-close" title="关闭" onClick={onClose}>
              <CloseIcon size={16} />
            </button>
          </div>
          {err && <div className="pm-err">{err}</div>}
          {reg && reg !== 'error' && reg.stale && <div className="pm-err">目录离线，正在显示缓存；条目状态可能已过期。</div>}
          {reg && reg !== 'error' && <div className="pm-sech">已发布包 {reg.entries.length} · 待接入 {reg.unavailable.length}（不代表已授权或可调用）</div>}
          {reg === 'error' && <div className="pm-err">拉不到插件目录，检查网络后点击刷新目录</div>}
          <div className="pm-body">{body}</div>
        </div>
      </div>

      {/* 权限确认框（层级高于市场弹窗）*/}
      {confirm && (
        <div className="cpk-modal-back" style={{ zIndex: 1600 }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="cpk-modal">
            <div className="cpk-modal-title">{confirm.installed ? '更新' : '安装'}「{confirm.displayName}」</div>
            <div className="cpk-modal-sub">
              v{confirm.version} · {fmtSize(confirm.size)}
            </div>
            {confirm.installed&&<section aria-label="更新权限变更">
              <div className="cpk-modal-label">相较已安装版本（画布权限与远程目标）：</div>
              {confirm.permissionChanges==null?<div className="cpk-modal-sub">旧版清单无法核验，请检查下方完整权限；不能确认是否新增权限。</div>:<>
                {confirm.permissionChanges.added.length>0&&<ul className="cpk-perms">{confirm.permissionChanges.added.map(p=><li key={p}>新增：{PERM_LABEL[p]??p}</li>)}</ul>}
                {confirm.permissionChanges.removed.length>0&&<ul className="cpk-perms">{confirm.permissionChanges.removed.map(p=><li key={p}>移除：{PERM_LABEL[p]??p}</li>)}</ul>}
                {!confirm.permissionChanges.added.length&&!confirm.permissionChanges.removed.length&&<div className="cpk-modal-sub">声明的画布权限与远程目标未变化。</div>}
              </>}
            </section>}
            {confirm.permissions.length ? (
              <>
                <div className="cpk-modal-label">装上后它可以：</div>
                <ul className="cpk-perms">
                  {confirm.permissions.map((p) => (
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
                {confirm.installed ? '确认更新' : '确认安装'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
