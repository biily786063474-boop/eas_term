// 归档计划审批面板。agent 通过 MCP 提交计划后弹出，**它在等这里的结果**。
//
// 这是第 2 期的安全核心。失败模式不是「分类不准」，是「我那个文件去哪了」——
// 发生一次，用户就再也不敢往收件箱里放东西，功能等于死了。
// 所以：先出计划、逐条可剔除、执行前落 git 快照、事后能整体回滚。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { CheckIcon, CloseIcon } from '../../ui/Icons'

export function ArchivePlanPanel(): JSX.Element | null {
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
    void window.api.wiki.snapshot('归档').then((r) =>
      setSnap(
        r.ok
          ? { ok: true, msg: '已落快照，出问题可一键退回' }
          : { ok: false, msg: r.error ?? '快照失败' }
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
          <b>归档计划</b>
          <span>
            agent 打算这样整理 {pending.items.length} 个文件 —— 过目一下，
            <b>确认后它才会动手</b>
          </span>
        </div>

        {snap && (
          <div className={`ap-snap${snap.ok ? ' ok' : ' warn'}`}>
            {snap.ok ? <CheckIcon size={11} /> : null}
            {snap.msg}
            {!snap.ok && <em>—— 没有 git 就没有「一键撤销」，建议先在知识库里开启</em>}
          </div>
        )}

        <div className="ap-list">
          {pending.items.map((it) => {
            const off = drop.has(it.name)
            return (
              <div key={it.name} className={`ap-row${off ? ' off' : ''}`}>
                <button className="ap-x" onClick={() => toggle(it.name)} data-tip={off ? '放回计划' : '这条不办'}>
                  {off ? <CheckIcon size={11} /> : <CloseIcon size={11} />}
                </button>
                <div className="ap-body">
                  <div className="ap-name">
                    {it.name}
                    {!!it.rename && it.rename !== it.name && <em>→ {it.rename}</em>}
                  </div>
                  {!!it.note && <div className="ap-note">写成 {it.note}</div>}
                  {!!it.reason && <div className="ap-reason">{it.reason}</div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="ap-tip">
          原件会被<b>移动</b>到 <code>素材/&lt;年月&gt;/</code>，不删除、不覆盖（重名自动加后缀）。
          笔记由 agent 写，写完你可以在知识库里逐篇看。
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
            全部取消
          </button>
          <span className="ap-spacer" />
          <span className="ap-count">
            {kept.length} / {pending.items.length} 条
          </span>
          <button
            className="ap-primary"
            disabled={busy || !kept.length}
            onClick={() => {
              setBusy(true)
              resolve(kept)
            }}
          >
            确认这 {kept.length} 条
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
