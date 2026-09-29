// 角色管理：排序、改分类、删除。从控制条的角色下拉进来。
//
// 为什么单独一个面板而不是塞进下拉：下拉是「选一个角色去干活」的地方，
// 那是高频动作；排序删除是低频的整理动作。混在一起会让每次选角色都要绕开一堆按钮。
//
// 排序用扁平列表而不是按分类分区渲染：分区渲染时「拖到另一组」和「改分类」是同一个动作，
// 但拖拽的落点判定会变得很绕；扁平列表 + 一个分类切换，两件事各归各的，都不会点错。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { AgentRole } from '../../../../shared/types'
import { useT } from '../../i18n.ts'
import { CloseIcon, PencilIcon, TrashIcon, UndoIcon } from '../../ui/Icons'

export function CanvasRoleManager({
  onClose,
  onEdit
}: {
  onClose: () => void
  onEdit: (roleId: string) => void
}): JSX.Element {
  const tr = useT()
  const roles = useStore((s) => s.roles)
  const saveRoles = useStore((s) => s.saveRoles)
  const resetRoles = useStore((s) => s.resetRoles)
  // 本地草稿：拖动时每一步都写盘会很卡，也会让「取消」无从谈起
  const [list, setList] = useState<AgentRole[]>(roles)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= list.length) return
    setList((l) => {
      const next = [...l]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })
  }
  const setGroup = (id: string, group: 'main' | 'output'): void =>
    setList((l) => l.map((r) => (r.id === id ? { ...r, group } : r)))
  const remove = (id: string): void => setList((l) => l.filter((r) => r.id !== id))

  const commit = async (): Promise<void> => {
    if (!list.length) {
      setErr(tr('panels.roleMgr.keepOne'))
      return
    }
    setBusy(true)
    const e = await saveRoles(list)
    setBusy(false)
    if (e) setErr(e)
    else onClose()
  }

  const dirty = JSON.stringify(list) !== JSON.stringify(roles)

  return createPortal(
    <div className="rm-mask" onMouseDown={onClose}>
      <div className="rm-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rm-head">
          <b>{tr('panels.roleMgr.title')}</b>
          <span>{tr('panels.roleMgr.sub')}</span>
          <button className="rm-x" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="rm-list">
          {list.map((r, i) => (
            <div
              key={r.id}
              className={`rm-row${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? ' over' : ''}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (drag !== null) move(drag, i)
                setDrag(null)
                setOver(null)
              }}
              onDragEnd={() => {
                setDrag(null)
                setOver(null)
              }}
            >
              <span className="rm-grip" data-tip={tr('panels.roleMgr.dragSort')}>
                ⠿
              </span>
              <span className="rm-dot" style={{ background: r.color }} />
              <span className="rm-name">
                {r.name}
                {r.builtin && <em>{tr('panels.role.builtin')}</em>}
              </span>
              <div className="rm-seg">
                <button
                  className={r.group === 'main' ? 'on' : ''}
                  onClick={() => setGroup(r.id, 'main')}
                  data-tip={tr('panels.roleMgr.mainTip')}
                >
                  {tr('panels.roleMgr.main')}
                </button>
                <button
                  className={r.group === 'output' ? 'on' : ''}
                  onClick={() => setGroup(r.id, 'output')}
                  data-tip={tr('panels.roleMgr.outputTip')}
                >
                  {tr('panels.roleMgr.output')}
                </button>
              </div>
              <button className="rm-icon" data-tip={tr('panels.common.edit')} onClick={() => onEdit(r.id)}>
                <PencilIcon size={11} />
              </button>
              <button className="rm-icon danger" data-tip={tr('panels.role.delete')} onClick={() => remove(r.id)}>
                <TrashIcon size={11} />
              </button>
            </div>
          ))}
        </div>

        {!!err && <div className="rm-err">{err}</div>}

        <div className="rm-foot">
          <button
            className="rm-ghost"
            disabled={busy}
            data-tip={tr('panels.roleMgr.resetTip')}
            onClick={() => void resetRoles().then(onClose)}
          >
            <UndoIcon size={12} /> {tr('panels.role.reset')}
          </button>
          <span className="rm-spacer" />
          {/* 删掉的角色如果有终端绑着，那些终端会回落成「无角色」——说清楚，别让人事后才发现 */}
          <span className="rm-note">{tr('panels.roleMgr.note')}</span>
          <button className="rm-ghost" onClick={onClose}>
            {tr('panels.common.cancel')}
          </button>
          <button className="rm-primary" disabled={busy || !dirty} onClick={() => void commit()}>
            {busy ? tr('panels.common.saving') : dirty ? tr('panels.common.save') : tr('panels.roleMgr.noChanges')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
