// 终端角上的钥匙角标：这个终端**启动时带了哪些密钥**。
//
// 为什么值得占一块界面：密钥是按终端授权的，而「带了什么」在终端里完全看不出来 ——
// 唯一的办法是 echo 一下，而那正是我们禁止 AI 干的事。没有这个角标，
// 用户碰到「这个终端里 key 怎么没了」时只能猜。两种最容易撞上的情况：
//   · 密钥柜锁着的时候开的终端 → 一条都不带（重启 app 后恢复的终端全是这样）
//   · 存密钥之前就开着的终端 → 带的是旧的那批
// 只显示**变量名**，永远不碰值。
import { useEffect, useState } from 'react'
import { KeyIcon } from '../../ui/Icons'
import { useT } from '../../i18n.ts'
import './terminal.css'

export function SecretBadge({ ptyId, scale = 1 }: { ptyId: string; scale?: number }): JSX.Element | null {
  const tr = useT()
  const [names, setNames] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.secrets.injectedIn(ptyId).then((r) => {
      if (alive) setNames(r)
    })
    return () => {
      alive = false
    }
  }, [ptyId])

  // 一条都没带就彻底不显示 —— 绝大多数终端都这样，挂个「0」只是噪音
  if (!names.length) return null

  return (
    <div
      className="sec-badge-wrap"
      style={{ transform: `scale(${scale})`, transformOrigin: 'bottom right' }}
    >
      {open && (
        <div className="sec-badge-pop">
          <div className="sec-badge-t">{tr('terminal.secretBadge.title')}</div>
          {names.map((n) => (
            <code key={n}>{n}</code>
          ))}
          <div className="sec-badge-note">
            {tr('terminal.secretBadge.note')}
          </div>
        </div>
      )}
      <button
        className="sec-badge"
        data-tip={tr('terminal.secretBadge.tip', { n: names.length })}
        onClick={() => setOpen((v) => !v)}
      >
        <KeyIcon size={10} />
        {names.length}
      </button>
    </div>
  )
}
