// 「扩展能力」总账：内置能力开关与旧版配置足迹；旧 rules/MCP 只读待迁移。
//
// 为什么要有这个：之前技能包的开关在标题栏、知识钩子的开关在词典里、
// 知识库规则的开关在知识库抽屉里，MCP 条目干脆没有开关（静默写入）。
// 分散的开关等于没有开关 —— 用户没法回答「这软件到底动了我什么」。
//
// 这份清单同时是写隐私策略的依据：策略里写什么，就以这里显示什么为准，
// 不要写一份和实际行为脱节的模板。
import { useCallback, useEffect, useState } from 'react'
import type { Footprint } from '../../../../shared/types'
import { CheckIcon, FolderOpenIcon } from '../../ui/Icons'
import { BuiltinCapabilitiesCard } from './BuiltinCapabilitiesCard'

/** 绝对路径缩成 ~/… ，全路径太长而且含用户名 */
function short(p: string): string {
  const i = p.indexOf('/.')
  if (i > 0) return '~' + p.slice(i)
  const j = p.lastIndexOf('/')
  return j > 0 ? '…' + p.slice(j) : p
}

/** 当前构建随包提供 BuiltinCapabilitiesCard 对应的内置能力插件。
 * 旧 rules/MCP 只展示已存在的待迁移足迹；不再提供全局注入入口。
 * 默认的历史标题栏实例保持空，不再读取状态或弹旧安装提示。 */
export function FootprintPanel({ mode }: { mode?: 'inline' } = {}): JSX.Element | null {
  const [items, setItems] = useState<Footprint[] | null>(null)
  const [busy, setBusy] = useState('')
  /** 哪几张卡片展开了。**默认全收起** —— 这个面板一共四条，每条都把「写了哪些文件」
   *  和整段说明铺开的话，一屏塞满，人反而找不到自己要看的那一条。
   *  默认层只留「这是什么 + 开没开 + 能怎么操作」，位置和解释点开才看。 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const refresh = useCallback(async (): Promise<void> => {
    setItems(await window.api.footprint.list())
  }, [])

  useEffect(() => {
    if (mode === 'inline') void refresh()
  }, [mode, refresh])

  const act = async (fn: () => Promise<unknown>, label: string): Promise<void> => {
    setBusy(label)
    await fn()
    await refresh()
    setBusy('')
  }

  if (mode !== 'inline' || !items) return null
  const legacy = (id: string): boolean => id === 'mcp' || id === 'rules'
  const visibleItems = items.filter(it => !legacy(it.id) || it.installed)

  const body = (
    <>
            <div className="fp-head">
              <span>扩展能力</span>
              <em>这个软件在你机器上写过的全部位置</em>
            </div>

            {mode === 'inline' && <BuiltinCapabilitiesCard />}

            {visibleItems.map((it) => (
              <div
                key={it.id}
                className={`fp-row${it.installed && !legacy(it.id) ? ' on' : ''}${expanded.has(it.id) ? ' open' : ''}`}
              >
                {/* 头部整块可点展开。按钮在它里面，靠 stopPropagation 各管各的 ——
                    做成独立的展开箭头也行，但那样点击目标只有 11px 宽，
                    而这个面板本来就是「想看细节才打开」的地方，整行可点更顺手 */}
                <div
                  className="fp-row-h"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded.has(it.id)}
                  onClick={() => toggle(it.id)}
                  onKeyDown={(e) => {
                    // **只认落在这一行本身的按键。** 不加这道守卫，焦点在行内按钮上
                    // 按 Enter 会冒泡到这里、被下面的 preventDefault 掐掉 ——
                    // 而 Enter 激活 <button> 正是 keydown 的默认行为，于是纯键盘用户
                    // 一颗按钮都点不动，按下去只会把卡片展开/收起。
                    // onClick 那侧的 stopPropagation 管不到键盘这条路，两边要各加各的。
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggle(it.id)
                    }
                  }}
                >
                  <span className="fp-chev" aria-hidden />
                  <span className="fp-name">{legacy(it.id) ? `${it.name}（旧版配置）` : it.name}</span>
                  <span className={`fp-tag ${it.installed && !legacy(it.id) ? 'ok' : 'off'}`}>
                    {it.installed && !legacy(it.id) ? <CheckIcon size={10} /> : null}
                    {legacy(it.id) ? '待迁移' : it.installed ? '已启用' : '未启用'}
                  </span>
                  {it.id === 'hook' && (
                    <button
                      className="fp-mini"
                      disabled={!!busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void act(
                          () =>
                            it.installed
                              ? window.api.hook.uninstall(['claude', 'codex'])
                              : window.api.hook.install(['claude', 'codex']),
                          it.installed ? '关闭中…' : '开启中…'
                        )
                      }}
                    >
                      {it.installed ? '关闭' : '开启'}
                    </button>
                  )}
                  {it.id === 'wiki' && it.installed && (
                    <button
                      className="fp-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.api.wiki.reveal()
                      }}
                    >
                      <FolderOpenIcon size={11} />
                    </button>
                  )}
                </div>
                {/* desc 是「这一条是什么」，留在默认层 —— 收起来的话卡片就只剩一个名字，
                    人得逐个点开才知道哪条是哪条，那不是渐进式披露，是把信息藏起来 */}
                <div className="fp-desc">{legacy(it.id) ? '旧版全局配置仍存在，待安全迁移；当前能力请使用上方内置模块开关。' : it.desc}</div>
                {expanded.has(it.id) && (
                  <div className="fp-more">
                    {!!it.files.length && (
                      <div className="fp-files">
                        {it.files.map((f) => (
                          <code key={f} title={f}>
                            {short(f)}
                          </code>
                        ))}
                      </div>
                    )}
                    {!legacy(it.id) && !!it.note && <div className="fp-note">{it.note}</div>}
                  </div>
                )}
              </div>
            ))}

            <div className="fp-foot">
              改动这些文件前都会留一份 <code>.eas-backup</code>；卸载只摘我们自己写的那部分，
              你自己的配置一个字不动。
            </div>
      {!!busy && <div className="fp-busy">{busy}</div>}
    </>
  )

  return <div className="fp-inline">{body}</div>
}
