// 「扩展能力」总账：Eas-Term 在这台机器上写过的**全部**位置，一处看全、逐个卸。
//
// 为什么要有这个：之前技能包的开关在标题栏、知识钩子的开关在词典里、
// 知识库规则的开关在知识库抽屉里，MCP 条目干脆没有开关（静默写入）。
// 分散的开关等于没有开关 —— 用户没法回答「这软件到底动了我什么」。
//
// 这份清单同时是写隐私策略的依据：策略里写什么，就以这里显示什么为准，
// 不要写一份和实际行为脱节的模板。
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Footprint, SkillStatus } from '../../../../shared/types'
import { CheckIcon, FolderOpenIcon } from '../../ui/Icons'

/** 绝对路径缩成 ~/… ，全路径太长而且含用户名 */
function short(p: string): string {
  const i = p.indexOf('/.')
  if (i > 0) return '~' + p.slice(i)
  const j = p.lastIndexOf('/')
  return j > 0 ? '…' + p.slice(j) : p
}

/** @param mode `inline` = 长在设置的分区里（只渲染内容体）；
 *               默认 = 常驻标题栏那个实例，**只负责一次性的启动提示**。 */
export function FootprintPanel({ mode }: { mode?: 'inline' } = {}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Footprint[] | null>(null)
  const [skill, setSkill] = useState<SkillStatus | null>(null)
  const [prompt, setPrompt] = useState(false)
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
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setItems(await window.api.footprint.list())
    setSkill(await window.api.skill.status())
  }, [])

  useEffect(() => {
    void (async () => {
      await refresh()
      const s = await window.api.skill.status()
      if (s.needsAttention && !s.muted) setPrompt(true)
    })()
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const act = async (fn: () => Promise<unknown>, label: string): Promise<void> => {
    setBusy(label)
    await fn()
    await refresh()
    setBusy('')
  }

  const install = async (): Promise<void> => {
    await window.api.rules.sync()
    await refresh()
    setPrompt(false)
  }

  if (!items) return null
  const pending = items.filter((x) => !x.installed && x.id === 'rules').length

  const body = (
    <>
            <div className="fp-head">
              <span>扩展能力</span>
              <em>这个软件在你机器上写过的全部位置</em>
            </div>

            {items.map((it) => (
              <div
                key={it.id}
                className={`fp-row${it.installed ? ' on' : ''}${expanded.has(it.id) ? ' open' : ''}`}
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
                  <span className="fp-name">{it.name}</span>
                  <span className={`fp-tag ${it.installed ? 'ok' : 'off'}`}>
                    {it.installed ? <CheckIcon size={10} /> : null}
                    {it.installed ? '已启用' : '未启用'}
                  </span>
                  {it.id === 'rules' && (
                    <button
                      className="fp-mini"
                      disabled={!!busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void act(
                          it.installed ? window.api.rules.remove : window.api.rules.sync,
                          it.installed ? '卸载中…' : '安装中…'
                        )
                      }}
                    >
                      {it.installed ? '卸载' : '安装'}
                    </button>
                  )}
                  {it.id === 'mcp' && !it.installed && (
                    <button
                      className="fp-act"
                      disabled={!!busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void act(window.api.mcp.installConfig, '安装中…')
                      }}
                    >
                      安装
                    </button>
                  )}
                  {it.id === 'mcp' && it.installed && (
                    <button
                      className="fp-mini"
                      disabled={!!busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void act(window.api.mcp.removeConfig, '移除中…')
                      }}
                    >
                      移除
                    </button>
                  )}
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
                <div className="fp-desc">{it.desc}</div>
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
                    {!!it.note && <div className="fp-note">{it.note}</div>}
                  </div>
                )}
              </div>
            ))}

            <div className="fp-foot">
              改动这些文件前都会留一份 <code>.eas-backup</code>；卸载只摘我们自己写的那部分，
              你自己的配置一个字不动。
              {skill?.muted && (
                <button
                  className="fp-link"
                  onClick={() => void window.api.skill.mute(false).then(setSkill)}
                >
                  恢复启动提醒
                </button>
              )}
            </div>
      {!!busy && <div className="fp-busy">{busy}</div>}
    </>
  )

  if (mode === 'inline') return <div className="fp-inline">{body}</div>

  // 标题栏那个按钮**没有了** —— 整块搬进了设置 →「隐私」（2026-08-31）。
  // 这个实例只剩一件事：那个一次性的启动提示。
  // 它不能跟着搬 —— 它的意义就是在你还没想到要去设置里翻的时候拦你一下。
  return (
    <>
      {/* 启动提示：只在装了 CLI 但指引没装、且用户没静音时出现一次 */}
      {prompt &&
        createPortal(
          <div className="skill-mask">
            <div className="skill-modal">
              <div className="skill-modal-title">让 AI 学会用这块画布</div>
              <p className="skill-modal-body">
                装上使用指引后，agent 会知道<b>什么时候</b>该把产出开成预览、什么时候整理画布、
                什么时候通知你 —— 而不是只丢给你一句「文件已生成」。
                <br />
                <span className="skill-modal-note">
                  它是纯文本，装到 <code>~/.claude/skills/</code> 和 <code>~/.codex/AGENTS.md</code>，
                  随时能在「扩展能力」里一键卸掉。
                </span>
              </p>
              <div className="skill-modal-actions">
                <button
                  className="skill-ghost"
                  onClick={() => {
                    void window.api.skill.mute(true).then(setSkill)
                    setPrompt(false)
                  }}
                >
                  永远不要提醒我
                </button>
                <span className="skill-spacer" />
                <button className="skill-ghost" onClick={() => setPrompt(false)}>
                  以后再说
                </button>
                <button className="skill-primary" onClick={() => void install()}>
                  安装
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}


    </>
  )
}
