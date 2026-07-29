// 词典里的「自动沉淀」开关条。
//
// 为什么不放进首启那一堆一起问：钩子会在用户**每次跑命令**时插入我们的代码，
// 在他所有项目里，永久 —— 这和「让模型多读一份说明」不是一个量级。
// 混进一个泛泛的「一键配置」，等于用一次笼统的同意换走一个具体的授权。
// 放在这里，用户是在**看着词典**的时候被问的，他知道这是干嘛用的，同意才有意义。
import { useCallback, useEffect, useState } from 'react'
import type { HookStatus } from '../../../../shared/types'
import { CheckIcon, SparkleIcon } from '../../ui/Icons'

type Target = 'claude' | 'codex'
const DISMISS_KEY = 'eas.dicthook.dismissed'

export function DictHookBar(): JSX.Element | null {
  const [st, setSt] = useState<HookStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setSt(await window.api.hook.status())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!st || !st.available) return null

  const rows: { key: Target; name: string }[] = [
    { key: 'claude', name: 'Claude Code' },
    { key: 'codex', name: 'Codex' }
  ]
  const usable = rows.filter((r) => st[r.key].hasCli)
  if (!usable.length) return null // 一个 CLI 都没有，钩子无处可装

  // 用户自己配过的那一侧不算「待装」——重复装等于同一个脚本每次提交跑两遍
  const pending = usable
    .filter((r) => !st[r.key].foreign && (!st[r.key].installed || st[r.key].outdated))
    .map((r) => r.key)
  const anyOn = usable.some((r) => st[r.key].installed || st[r.key].foreign)

  const run = async (fn: 'install' | 'uninstall', targets: Target[]): Promise<void> => {
    if (!targets.length) return
    setBusy(true)
    const r = await window.api.hook[fn](targets)
    setBusy(false)
    if (r.ok && r.status) {
      setSt(r.status)
      setMsg(fn === 'install' ? '已开启' : '已关闭')
      setTimeout(() => setMsg(''), 2600)
    } else {
      setMsg('失败：' + (r.error ?? '未知错误'))
    }
  }

  // 还没装 + 用户没说过「不用了」 → 展示邀请条
  if (pending.length && !anyOn && !dismissed) {
    return (
      <div className="dhb dhb-invite">
        <SparkleIcon size={12} />
        <div className="dhb-text">
          <b>让这份词典自己长大</b>
          <span>
            开启后，每次 git commit 会扫一遍新增代码，把你用到、但词典里没有的术语自动收进来。
            纯脚本，不花 token。
          </span>
        </div>
        <div className="dhb-acts">
          <button
            className="dhb-ghost"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, '1')
              setDismissed(true)
            }}
          >
            不用
          </button>
          <button className="dhb-primary" disabled={busy} onClick={() => void run('install', pending)}>
            {busy ? '…' : '开启'}
          </button>
        </div>
      </div>
    )
  }

  // 已装（或用户关过又想回来）→ 一行状态，点开能看到装在哪、能关掉
  return (
    <div className={`dhb${expanded ? ' open' : ''}`}>
      <button className="dhb-toggle" onClick={() => setExpanded((v) => !v)}>
        {anyOn ? <CheckIcon size={11} /> : <SparkleIcon size={11} />}
        <span>{anyOn ? '自动沉淀已开启' : '自动沉淀已关闭'}</span>
        {!!msg && <span className="dhb-msg">{msg}</span>}
        <span className="dhb-chev">{expanded ? '收起' : '详情'}</span>
      </button>
      {expanded && (
        <div className="dhb-detail">
          {usable.map((r) => {
            const a = st[r.key]
            return (
              <div key={r.key} className="dhb-row">
                <span className="dhb-name">{r.name}</span>
                <span
                  className={`dhb-tag ${a.foreign ? 'ok' : a.installed ? (a.outdated ? 'todo' : 'ok') : 'dim'}`}
                >
                  {a.foreign
                    ? '你已自行配置'
                    : a.installed
                      ? a.outdated
                        ? '路径已变，需重装'
                        : '已开启'
                      : '未开启'}
                </span>
                {/* 用户自己配的那条我们一个字都不动，连按钮都不给 —— 免得误删他的配置 */}
                {!a.foreign && (
                  <button
                    className="dhb-mini"
                    disabled={busy}
                    onClick={() =>
                      void run(a.installed && !a.outdated ? 'uninstall' : 'install', [r.key])
                    }
                  >
                    {a.installed && !a.outdated ? '关闭' : a.outdated ? '重装' : '开启'}
                  </button>
                )}
              </div>
            )
          })}
          {/* 如实告诉用户我们动了他哪份配置——这是侵入性最高的一项，不该含糊 */}
          <div className="dhb-note">
            写入 <code>{usable.map((r) => shortPath(st[r.key].configPath)).join(' 和 ')}</code>
            ，只增删我们自己那一条，改前会留一份 <code>.eas-backup</code>。
          </div>
          {st.codex.hasCli && st.codex.installed && (
            <div className="dhb-note warn">
              Codex 侧还需要你在它里面跑一次 <code>/hooks</code> 确认信任，否则不会执行。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** ~/.claude/settings.json 这种短形式，全路径太长且含用户名 */
function shortPath(p: string): string {
  const i = p.indexOf('/.')
  return i > 0 ? '~' + p.slice(i) : p
}
