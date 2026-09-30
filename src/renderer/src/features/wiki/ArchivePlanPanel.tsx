// 归档计划审批面板。agent 通过 MCP 提交计划后弹出，**它在等这里的结果**。
//
// 这是第 2 期的安全核心。失败模式不是「分类不准」，是「我那个文件去哪了」——
// 发生一次，用户就再也不敢往收件箱里放东西，功能等于死了。
// 所以：先出计划、逐条可剔除、执行前落 git 快照、事后能整体回滚。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { CheckIcon, CloseIcon } from '../../ui/Icons'
import { useT } from '../../i18n.ts'

const MATERIAL_DIR = '素材/<年月>/' // i18n-allow: 磁盘上的真实目录名

export function ArchivePlanPanel(): JSX.Element | null {
  const tr = useT()
  const pending = useStore((s) => s.pendingArchive)
  const resolve = useStore((s) => s.resolveArchivePlan)
  const [drop, setDrop] = useState<Set<string>>(new Set())
  const [snap, setSnap] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // 新计划进来时把上一份的剔除状态清掉
  useEffect(() => {
    setDrop(new Set())
    setSnap(null)
  }, [pending])

  // 面板一出现就先落一个快照——等用户点完再落就晚了，
  // 因为 agent 拿到批准后会立刻开始动文件
  useEffect(() => {
    if (!pending) return
    void window.api.wiki.snapshot('归档').then((r) => // i18n-allow: 快照标签是存档数据
      setSnap(
        r.ok
          ? { ok: true, msg: tr('wikiUi.plan.snapOk') }
          : { ok: false, msg: r.error ?? tr('wikiUi.plan.snapFail') }
      )
    )
  }, [pending])

  if (!pending) return null

  const kept = pending.items.filter((x) => !drop.has(x.name))
  const toggle = (n: string): void =>
    setDrop((d) => {
      const next = new Set(d)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  return createPortal(
    <div className="ap-mask">
      <div className="ap-panel">
        <div className="ap-head">
          <b>{tr('wikiUi.plan.title')}</b>
          <span>
            {tr('wikiUi.plan.headBefore', { n: pending.items.length })}
            <b>{tr('wikiUi.plan.headBold')}</b>
          </span>
        </div>

        {snap && (
          <div className={`ap-snap${snap.ok ? ' ok' : ' warn'}`}>
            {snap.ok ? <CheckIcon size={11} /> : null}
            {snap.msg}
            {!snap.ok && <em>{tr('wikiUi.plan.snapWarn')}</em>}
          </div>
        )}

        <div className="ap-list">
          {pending.items.map((it) => {
            const off = drop.has(it.name)
            return (
              <div key={it.name} className={`ap-row${off ? ' off' : ''}`}>
                <button className="ap-x" onClick={() => toggle(it.name)} data-tip={off ? tr('wikiUi.plan.restore') : tr('wikiUi.plan.skip')}>
                  {off ? <CheckIcon size={11} /> : <CloseIcon size={11} />}
                </button>
                <div className="ap-body">
                  <div className="ap-name">
                    {it.name}
                    {!!it.rename && it.rename !== it.name && <em>→ {it.rename}</em>}
                  </div>
                  {!!it.note && <div className="ap-note">{tr('wikiUi.plan.noteAs', { note: it.note })}</div>}
                  {!!it.reason && <div className="ap-reason">{it.reason}</div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="ap-tip">
          {tr('wikiUi.plan.tipA')}
          <b>{tr('wikiUi.plan.tipMove')}</b>
          {tr('wikiUi.plan.tipB')}
          <code>{MATERIAL_DIR}</code>
          {tr('wikiUi.plan.tipC')}
        </div>

        <div className="ap-foot">
          <button
            className="ap-ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              resolve(null)
            }}
          >
            {tr('wikiUi.plan.cancelAll')}
          </button>
          <span className="ap-spacer" />
          <span className="ap-count">
            {tr('wikiUi.plan.count', { k: kept.length, n: pending.items.length })}
          </span>
          <button
            className="ap-primary"
            disabled={busy || !kept.length}
            onClick={() => {
              setBusy(true)
              resolve(kept)
            }}
          >
            {tr('wikiUi.plan.confirm', { k: kept.length })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
