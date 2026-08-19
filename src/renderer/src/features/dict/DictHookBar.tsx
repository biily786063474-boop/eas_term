// 词典里的「自动补全词条」开关条。
//
// 为什么不放进首启那一堆一起问：钩子会在用户**每次跑命令**时插入我们的代码，
// 在他所有项目里，永久 —— 这和「让模型多读一份说明」不是一个量级。
// 混进一个泛泛的「一键配置」，等于用一次笼统的同意换走一个具体的授权。
// 放在这里，用户是在**看着词典**的时候被问的，他知道这是干嘛用的，同意才有意义。
//
// 这里管着两个独立的开关，不能合并：
//   1. 钩子装没装 —— 决定「提交后扫不扫代码」。纯脚本，零 token。
//   2. 补全开不开 —— 决定「发现生词后要不要让模型写成完整词条」。**要花 token。**
// 老用户当初是按「纯脚本，不花 token」装的钩子，拿那次同意去顶这次的消费不成立，
// 所以第 2 项对所有人都默认关，必须单独点一次。
import { useCallback, useEffect, useState } from 'react'
import type { DictSinkStatus, HookStatus, AgentKind } from '../../../../shared/types'
import { CheckIcon, SparkleIcon } from '../../ui/Icons'

// **刻意不用 AgentKind。** 这是面 4（提交钩子）的类型，而钩子这个面只对
// 「有钩子机制的 CLI」成立 —— 没有钩子机制的 CLI，手册的规矩是跳过这个面，
// 不是发明一个。跟着 AgentKind 走的话，这里会多出一个永远装不上的行。
type Target = 'claude' | 'codex'
const DISMISS_KEY = 'eas.dicthook.dismissed'

export function DictHookBar(): JSX.Element | null {
  const [st, setSt] = useState<HookStatus | null>(null)
  const [sink, setSink] = useState<DictSinkStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const [expanded, setExpanded] = useState(false)
  // 点了「开启」之后先摊开成本再问一次。不是走过场——这一步之后就开始花钱了
  const [confirming, setConfirming] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const [h, s] = await Promise.all([window.api.hook.status(), window.api.dict.sinkStatus()])
    setSt(h)
    setSink(s)
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!st || !st.available || !sink) return null

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
  const hookOn = usable.some((r) => st[r.key].installed || st[r.key].foreign)

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

  const toggleSink = async (on: boolean): Promise<void> => {
    setBusy(true)
    setSink(await window.api.dict.setSink(on))
    setBusy(false)
    setMsg(on ? '已开启补全' : '已关闭补全')
    setTimeout(() => setMsg(''), 2600)
  }

  // 全新用户（钩子没装、也没说过「不用了」）→ 邀请条
  if (pending.length && !hookOn && !dismissed) {
    return (
      // 确认态的文案有三行，横排会把按钮挤成一条缝，改成上下摞
      <div className={`dhb dhb-invite${confirming ? ' stack' : ''}`}>
        <SparkleIcon size={12} />
        {confirming ? (
          <>
            <div className="dhb-text">
              <b>开启前说清楚会发生什么</b>
              {/* 三条都是实打实会发生的事。含糊其辞换来的同意，出问题时一文不值 */}
              <span>
                · 每次 <code>git commit</code> 后跑一段脚本，扫本次新增的代码 —— 这步不花 token。
                <br />· 扫到词典里没有的术语时，<b>请你的模型写成完整词条</b>
                （中英文名 + 解释 + 示意图 + 分类）—— <b>这步要花 token</b>，一个词大致几百到一千。
                <br />· 词条写进 <code>~/.eas/dict-user.json</code>，只在本机，不上传。
              </span>
            </div>
            <div className="dhb-acts">
              <button className="dhb-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                再想想
              </button>
              <button
                className="dhb-primary"
                disabled={busy}
                onClick={() =>
                  void run('install', pending).then(() => {
                    setConfirming(false)
                    return toggleSink(true)
                  })
                }
              >
                {busy ? '…' : '知道了，开启'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dhb-text">
              <b>让这份词典自己长大</b>
              <span>
                开启后，每次 git commit 会扫一遍新增代码，把你用到、但词典里没有的术语补成完整词条
                （有解释、有示意图、归好类）。补全由你的模型执行，<b>会消耗 token</b>。
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
              <button className="dhb-primary" onClick={() => setConfirming(true)}>
                开启
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // 已装（或用户关过又想回来）→ 一行状态，点开能看到装在哪、能分别开关
  return (
    <div className={`dhb${expanded ? ' open' : ''}`}>
      <button className="dhb-toggle" onClick={() => setExpanded((v) => !v)}>
        {hookOn ? <CheckIcon size={11} /> : <SparkleIcon size={11} />}
        <span>
          {hookOn ? (sink.enabled ? '自动补全已开启' : '提交扫描已开启 · 补全未开') : '自动补全已关闭'}
        </span>
        {/* 有词排着队但补全关着，是最容易被忽略的一种状态，摆在收起态就得看见 */}
        {sink.pending > 0 && <span className="dhb-badge">{sink.pending} 待补</span>}
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

          {/* 花钱的那一项单独一行，标签直说「花 token」，不藏在说明文字里 */}
          <div className="dhb-row">
            <span className="dhb-name">补全成完整词条</span>
            <span className={`dhb-tag ${sink.enabled ? 'todo' : 'dim'}`}>
              {sink.enabled ? '开启 · 花 token' : '未开启'}
            </span>
            <button className="dhb-mini" disabled={busy} onClick={() => void toggleSink(!sink.enabled)}>
              {sink.enabled ? '关闭' : '开启'}
            </button>
          </div>

          {sink.pending > 0 && (
            <div className="dhb-note">
              有 {sink.pending} 个词排着队。
              {sink.enabled
                ? '下次提交后跟 agent 说话时它会顺手补上；也可以直接让它「补一下词典待办」。'
                : '补全没开，这些词会一直排着——开了才会被写成词条。'}
            </div>
          )}

          {/* 如实告诉用户我们动了他哪份配置——这是侵入性最高的一项，不该含糊 */}
          <div className="dhb-note">
            写入 <code>{usable.map((r) => shortPath(st[r.key].configPath)).join(' 和 ')}</code>
            ，只增删我们自己那一条，改前会留一份 <code>.eas-backup</code>。词条落在
            <code>~/.eas/dict-user.json</code>，只在本机。
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
