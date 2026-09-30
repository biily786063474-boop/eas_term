// 创作参考里的「提交即复盘」开关条。
//
// 为什么不放进首启那一堆一起问：钩子会在用户**每次跑命令**时插入我们的代码，
// 在他所有项目里，永久 —— 这和「让模型多读一份说明」不是一个量级。
// 混进一个泛泛的「一键配置」，等于用一次笼统的同意换走一个具体的授权。
// 放在这里，用户是在**看着创作参考**的时候被问的，他知道这是干嘛用的，同意才有意义。
//
// ── 2026-08-31：这里原来管着两个开关，现在只剩一个 ────────────────────
// 拆掉的那个是「自动补全词条」：发现创作参考没收录的术语就让模型写成完整词条。
// 三条理由（见 docs/创作参考改造方案.html）：归类只能靠猜、产不出 hover 要看的示意图、
// **在你没看的时候花钱**。想加一条改成主动跟 agent 说一句，见下面那条说明。
//
// 留下的这个是纯脚本、零 token：提交后扫新增代码，命中**已收录**的词条就记进
// docs/knowledge-manual.html。它不收集新词，只回答「这次用到了哪些概念」。
import { useCallback, useEffect, useState } from 'react'
import type { HookStatus, AgentKind } from '../../../../shared/types'
import { CheckIcon, SparkleIcon } from '../../ui/Icons'
import { useT } from '../../i18n.ts'
import { rich } from '../canvas/pluginRich'

// **刻意不用 AgentKind。** 这是面 4（提交钩子）的类型，而钩子这个面只对
// 「有钩子机制的 CLI」成立 —— 没有钩子机制的 CLI，手册的规矩是跳过这个面，
// 不是发明一个。跟着 AgentKind 走的话，这里会多出一个永远装不上的行。
type Target = 'claude' | 'codex'
const DISMISS_KEY = 'eas.dicthook.dismissed'

export function DictHookBar(): JSX.Element | null {
  const t = useT()
  const [st, setSt] = useState<HookStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const [expanded, setExpanded] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  // 点了「开启」之后先摊开会发生什么再问一次。它要往用户的 CLI 配置里写东西，
  // 不是走过场
  const [confirming, setConfirming] = useState(false)

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
  const hookOn = usable.some((r) => st[r.key].installed || st[r.key].foreign)

  const run = async (fn: 'install' | 'uninstall', targets: Target[]): Promise<void> => {
    if (!targets.length) return
    setBusy(true)
    const r = await window.api.hook[fn](targets)
    setBusy(false)
    if (r.ok && r.status) {
      setSt(r.status)
      setMsg(fn === 'install' ? t('dictUi.hook.enabled') : t('dictUi.hook.disabled'))
      setTimeout(() => setMsg(''), 2600)
    } else {
      setMsg(t('dictUi.hook.failed', { error: r.error ?? t('dictUi.hook.unknownError') }))
    }
  }

  // 全新用户（钩子没装、也没说过「不用了」）→ 邀请条
  if (pending.length && !hookOn && !dismissed) {
    return (
      // 确认态的文案有三行，横排会把按钮挤成一条缝，改成上下摞
      <div className={`dhb dhb-invite${confirming ? ' stack' : ' compact'}`}>
        <SparkleIcon size={12} />
        {confirming ? (
          <>
            <div className="dhb-text">
              <b>{t('dictUi.hook.confirmTitle')}</b>
              {/* 三条都是实打实会发生的事。含糊其辞换来的同意，出问题时一文不值 */}
              <span>{rich(t('dictUi.hook.confirmBody'))}</span>
            </div>
            <div className="dhb-acts">
              <button className="dhb-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                {t('dictUi.hook.later')}
              </button>
              <button
                className="dhb-primary"
                disabled={busy}
                onClick={() =>
                  void run('install', pending).then(() => setConfirming(false))
                }
              >
                {busy ? '…' : t('dictUi.hook.confirm')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dhb-text">
              <b>{t('dictUi.hook.inviteTitle')}</b>
              <span>{t('dictUi.hook.inviteSub')}</span>

            </div>
            <div className="dhb-acts">
              <button className="dhb-ghost" aria-label={t('dictUi.hook.infoAria')} aria-expanded={infoOpen}
                onClick={() => setInfoOpen(v => !v)}>ⓘ</button>
              <button className="dhb-primary" onClick={() => setConfirming(true)}>
                {t('dictUi.hook.enable')}
              </button>
              <button
                className="dhb-ghost" aria-label={t('dictUi.hook.dismissAria')}
                onClick={() => {
                  localStorage.setItem(DISMISS_KEY, '1')
                  setDismissed(true)
                }}
              >
                ×
              </button>
            </div>
            {infoOpen && <div className="dhb-info">{t('dictUi.hook.info')}</div>}
            {!!msg && <div className="dhb-info" role="status">{msg}</div>}
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
        <span>{hookOn ? t('dictUi.hook.statusOn') : t('dictUi.hook.statusOff')}</span>
        {!!msg && <span className="dhb-msg">{msg}</span>}
        <span className="dhb-chev">{expanded ? t('dictUi.hook.collapse') : t('dictUi.hook.details')}</span>
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
                    ? t('dictUi.hook.foreign')
                    : a.installed
                      ? a.outdated
                        ? t('dictUi.hook.outdated')
                        : t('dictUi.hook.enabled')
                      : t('dictUi.hook.off')}
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
                    {a.installed && !a.outdated ? t('dictUi.hook.turnOff') : a.outdated ? t('dictUi.hook.reinstall') : t('dictUi.hook.enable')}
                  </button>
                )}
              </div>
            )
          })}

          {/* 原来这儿是「自动补全词条」开关。拆掉之后不能只留一片空白 ——
              用户会以为加词条这件事没了出口 */}
          <div className="dhb-note">{rich(t('dictUi.hook.addNote'))}</div>

          {/* 如实告诉用户我们动了他哪份配置——这是侵入性最高的一项，不该含糊 */}
          <div className="dhb-note">
            {rich(t('dictUi.hook.writeNote', { paths: usable.map((r) => shortPath(st[r.key].configPath)).join(t('dictUi.hook.pathJoin')) }))}
          </div>
          {st.codex.hasCli && st.codex.installed && (
            <div className="dhb-note warn">{rich(t('dictUi.hook.codexWarn'))}</div>
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
