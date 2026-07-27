// 「扩展能力」：给 Claude Code / Codex 装配套技能包。
//
// MCP 把工具摆出去了，但模型不一定知道**什么时候该用** —— 用户说「打开这个 html」，
// 模型更可能去 Read 文件。技能包就是那份使用指引。
//
// 交互按用户要求：启动时若检测到装了 CLI 但没装技能包 → 弹一次提示；
// 用户点「永远不要提醒」就不再弹，改由标题栏这个按钮兜底，随时能回来装。
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SkillStatus, AgentStatus } from '../../../../shared/types'
import { SparkleIcon, CheckIcon } from '../../ui/Icons'

type Target = 'claude' | 'codex'

function label(a: AgentStatus): { text: string; cls: string } {
  if (!a.hasCli) return { text: '未安装 CLI', cls: 'dim' }
  if (!a.installed) return { text: '待安装', cls: 'todo' }
  if (a.outdated) return { text: '可更新', cls: 'todo' }
  return { text: '已就绪', cls: 'ok' }
}

export function SkillPanel(): JSX.Element | null {
  const [status, setStatus] = useState<SkillStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [prompt, setPrompt] = useState(false) // 启动时的一次性提示
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<SkillStatus> => {
    const s = await window.api.skill.status()
    setStatus(s)
    return s
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await refresh()
      // 装了 CLI 但技能包缺失/过期，且用户没说「永远别提醒」→ 弹一次
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

  const install = async (targets: Target[]): Promise<void> => {
    if (!targets.length) return
    setBusy(true)
    const r = await window.api.skill.install(targets)
    setBusy(false)
    if (r.ok && r.status) {
      setStatus(r.status)
      setDone('已装到 ' + (r.done ?? []).join(' / '))
      setTimeout(() => setDone(''), 3000)
    } else {
      setDone('失败：' + (r.error ?? '未知错误'))
    }
    setPrompt(false)
  }

  /** 弹窗/面板里「一键安装」要装谁：装了 CLI 且还没就绪的那些 */
  const pending = (s: SkillStatus): Target[] =>
    (['claude', 'codex'] as Target[]).filter((k) => s[k].hasCli && (!s[k].installed || s[k].outdated))

  if (!status) return null

  const rows: { key: Target; name: string; a: AgentStatus }[] = [
    { key: 'claude', name: 'Claude Code', a: status.claude },
    { key: 'codex', name: 'Codex', a: status.codex }
  ]
  const todo = pending(status)

  return (
    <>
      <button
        ref={btnRef}
        className={`skill-btn${todo.length ? ' has-todo' : ''}`}
        data-tip="扩展能力：给 Claude Code / Codex 装配套技能包"
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setPos({ x: Math.max(8, r.right - 320), y: r.bottom + 6 })
          setOpen((v) => !v)
          void refresh()
        }}
      >
        <SparkleIcon size={13} />
        <span>扩展能力</span>
        {!!todo.length && <span className="skill-dot" />}
      </button>

      {/* 启动提示：只在「装了 CLI 但技能包没装」且用户没静音时出现一次 */}
      {prompt &&
        createPortal(
          <div className="skill-mask">
            <div className="skill-modal">
              <div className="skill-modal-title">让 AI 学会用这块画布</div>
              <p className="skill-modal-body">
                检测到你装了 <b>{rows.filter((r) => r.a.hasCli).map((r) => r.name).join(' 和 ')}</b>。
                装上配套技能包后，它们会知道<b>什么时候</b>该把产出开成预览、什么时候整理画布、
                什么时候通知你 —— 而不是只丢给你一句「文件已生成」。
                <br />
                <span className="skill-modal-note">
                  技能包是一份纯文本使用指引，装到{' '}
                  <code>~/.claude/skills/</code> 和 <code>~/.codex/AGENTS.md</code>，随时可删。
                </span>
              </p>
              <div className="skill-modal-actions">
                <button
                  className="skill-ghost"
                  onClick={() => {
                    void window.api.skill.mute(true).then(setStatus)
                    setPrompt(false)
                  }}
                >
                  永远不要提醒我
                </button>
                <span className="skill-spacer" />
                <button className="skill-ghost" onClick={() => setPrompt(false)}>
                  以后再说
                </button>
                <button className="skill-primary" disabled={busy} onClick={() => void install(todo)}>
                  {busy ? '安装中…' : '安装'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {open &&
        createPortal(
          <div className="skill-pop" ref={popRef} style={{ left: pos.x, top: pos.y }}>
            <div className="skill-pop-head">
              <span>扩展能力</span>
              {!!done && <span className="skill-done">{done}</span>}
            </div>
            <p className="skill-pop-note">
              技能包告诉 AI <b>什么时候</b>该用画板工具（开预览、整理、通知），
              不装也能用，只是得你自己开口要。
            </p>
            {rows.map((r) => {
              const l = label(r.a)
              return (
                <div key={r.key} className="skill-row">
                  <span className="skill-row-name">{r.name}</span>
                  <span className={`skill-tag ${l.cls}`}>
                    {l.cls === 'ok' && <CheckIcon size={11} />}
                    {l.text}
                  </span>
                  {r.a.hasCli && (
                    <button
                      className="skill-mini"
                      disabled={busy || (r.a.installed && !r.a.outdated)}
                      onClick={() => void install([r.key])}
                    >
                      {r.a.installed ? (r.a.outdated ? '更新' : '已装') : '安装'}
                    </button>
                  )}
                </div>
              )
            })}
            {status.muted && (
              <button
                className="skill-remind"
                onClick={() => void window.api.skill.mute(false).then(setStatus)}
              >
                恢复启动提醒
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
