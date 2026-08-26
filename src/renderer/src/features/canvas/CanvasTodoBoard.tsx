// 待办清单模块：一个模块装多条待办，自由存在（不属于任何 Frame），世界坐标。
//
// 渲染层级共享 CanvasShapeLayer（矩形/箭头/批注同一个 z-index 15 层，压在活终端之上、
// 画板外 chrome 之下）——本文件由 CanvasShapeLayer 在 .canvas-shape-world 里挂载，
// 跟着同一份 viewport transform 走，不用自己处理缩放/平移。
// 数据是 canvas.todos，独立于 canvas.shapes（原因见 store/canvas/types.ts 的 TodoBoard
// 类型注释：clearShapes 快照后清标记不该连带清掉待办）。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { TodoBoard, TodoItem } from '../../store'
import { attachBlurGuard } from '../../blurGuard'
import { VoiceButton } from '../voice/VoiceButton'
import { arrayMove, dropIndexForOffset, groupTodoItems } from '../../store/canvas/todoBoard'
import { PlusIcon, CheckIcon, ChevronDownIcon, CloseIcon } from '../../ui/Icons'

/** 待办卡片的固定行高 + 行间距（换算拖拽位移用，见 dropIndexForOffset）。
 *  卡片标题单行省略号，行高不随内容变化——这是让「index × ROW_STEP」定位法成立的前提。 */
const ROW_H = 40
const ROW_GAP = 8
const ROW_STEP = ROW_H + ROW_GAP
/** 灯箱退场动效时长，要跟 CSS 里 .ctodo-lightbox 的 transition 时长对上，
 *  不然要么卡片先没了动效被截断，要么卸载晚了露出一帧静止画面。 */
const LIGHTBOX_EXIT_MS = 200

/** 拖拽把手：六个小圆点，仓库图标集里没有现成的，就地画一个 */
function GripDots(): JSX.Element {
  return (
    <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
      <circle cx="2.5" cy="2.5" r="1.3" />
      <circle cx="7.5" cy="2.5" r="1.3" />
      <circle cx="2.5" cy="8" r="1.3" />
      <circle cx="7.5" cy="8" r="1.3" />
      <circle cx="2.5" cy="13.5" r="1.3" />
      <circle cx="7.5" cy="13.5" r="1.3" />
    </svg>
  )
}

export function CanvasTodoBoards(): JSX.Element | null {
  const boards = useStore((s) => s.canvas.todos)
  if (!boards.length) return null
  return (
    <>
      {boards.map((b) => (
        <TodoBoardCard key={b.id} board={b} />
      ))}
    </>
  )
}

interface DragState {
  id: string
  fromIndex: number
  offsetY: number
  /** 拖拽中的实时预览顺序（仅未完成子集的 id 列表），松手时提交给 store */
  order: string[]
}

function TodoBoardCard({ board }: { board: TodoBoard }): JSX.Element {
  const moveTodoBoard = useStore((s) => s.moveTodoBoard)
  const renameTodoBoard = useStore((s) => s.renameTodoBoard)
  const addTodoItem = useStore((s) => s.addTodoItem)
  const reorderTodoItem = useStore((s) => s.reorderTodoItem)

  const [renaming, setRenaming] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const { pending, done } = groupTodoItems(board.items)

  const startBoardDrag = (e: React.MouseEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return
    e.stopPropagation()
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const x0 = board.x
    const y0 = board.y
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void =>
      moveTodoBoard(board.id, x0 + (ev.clientX - sx) / scale, y0 + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 拖拽中真失焦（灵动岛跳转等）→ 当场收尾，不留悬空监听；同 CanvasShapeLayer 的
    // startShapeDrag 一样的理由，这里原样照抄
    detachBlur = attachBlurGuard(onUp)
  }

  const startItemDrag = (item: TodoItem, index: number, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const scale = useStore.getState().canvas.viewport.scale
    const pendingIds = pending.map((it) => it.id)
    setDrag({ id: item.id, fromIndex: index, offsetY: 0, order: pendingIds })
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void => {
      const dy = (ev.clientY - startY) / scale
      const toIndex = dropIndexForOffset(pendingIds.length, index, dy, ROW_STEP)
      setDrag({ id: item.id, fromIndex: index, offsetY: dy, order: arrayMove(pendingIds, index, toIndex) })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
      setDrag((cur) => {
        if (cur) {
          const finalIndex = cur.order.indexOf(cur.id)
          if (finalIndex !== -1 && finalIndex !== cur.fromIndex) reorderTodoItem(board.id, cur.id, finalIndex)
        }
        return null
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    detachBlur = attachBlurGuard(onUp)
  }

  const pendingHeight = Math.max(0, pending.length * ROW_STEP - ROW_GAP)
  const lightboxItem = lightboxItemId ? board.items.find((it) => it.id === lightboxItemId) : undefined

  return (
    <div
      className="ctodo-board"
      data-tid={board.id}
      style={{ left: board.x, top: board.y, width: board.w }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ctodo-head" onMouseDown={startBoardDrag} onDoubleClick={() => setRenaming(true)}>
        {renaming ? (
          <input
            className="ctodo-rename"
            defaultValue={board.title ?? ''}
            placeholder="待办清单"
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameTodoBoard(board.id, e.target.value.trim())
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="ctodo-title">{board.title || '待办清单'}</span>
        )}
        <button
          className="ctodo-add"
          data-tip="添加一个待办"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setEditingItemId(addTodoItem(board.id))}
        >
          <PlusIcon size={13} />
        </button>
      </div>

      <div className="ctodo-body">
        {board.items.length === 0 && <div className="ctodo-empty">暂无待办</div>}

        <div className="ctodo-pending" style={{ height: pendingHeight }}>
          {pending.map((item, index) => {
            const dragging = drag?.id === item.id
            const slot = drag ? drag.order.indexOf(item.id) : index
            const top = dragging ? index * ROW_STEP + drag!.offsetY : slot * ROW_STEP
            return (
              <TodoItemRow
                key={item.id}
                boardId={board.id}
                item={item}
                editing={editingItemId === item.id}
                onDoneEditing={() => setEditingItemId(null)}
                onOpenLightbox={() => setLightboxItemId(item.id)}
                style={{
                  top,
                  zIndex: dragging ? 2 : 1,
                  // 拖拽中 top 不过渡（1:1 跟手，不能有延迟感）；transform/box-shadow 仍然过渡，
                  // 抓起的一瞬间「长大」是有动效的，不是硬切——只是不走 CSS 类里连 top 一起
                  // 过渡的那条规则，改用内联单独列出要过渡的属性。
                  transition: dragging
                    ? 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.22s ease'
                    : undefined
                }}
                dragging={dragging}
                onHandleMouseDown={(e) => startItemDrag(item, index, e)}
              />
            )
          })}
        </div>

        {done.length > 0 && (
          <button className="ctodo-done-toggle" onClick={() => setDoneOpen((v) => !v)}>
            <ChevronDownIcon className={`ctodo-chevron${doneOpen ? ' open' : ''}`} size={12} />
            已完成 {done.length}
          </button>
        )}

        {doneOpen && done.length > 0 && (
          <div className="ctodo-done-list">
            {done.map((item) => (
              <TodoItemRow
                key={item.id}
                boardId={board.id}
                item={item}
                editing={false}
                onDoneEditing={() => {}}
                onOpenLightbox={() => setLightboxItemId(item.id)}
                flow
              />
            ))}
          </div>
        )}
      </div>

      {lightboxItem && (
        <TodoLightbox boardId={board.id} item={lightboxItem} onClose={() => setLightboxItemId(null)} />
      )}
    </div>
  )
}

function TodoItemRow({
  boardId,
  item,
  editing,
  onDoneEditing,
  onOpenLightbox,
  style,
  dragging,
  onHandleMouseDown,
  flow
}: {
  boardId: string
  item: TodoItem
  editing: boolean
  onDoneEditing: () => void
  onOpenLightbox: () => void
  style?: React.CSSProperties
  dragging?: boolean
  onHandleMouseDown?: (e: React.MouseEvent) => void
  /** 已完成区：普通流式排列，不用绝对定位（不需要拖拽动画） */
  flow?: boolean
}): JSX.Element {
  const updateTodoItem = useStore((s) => s.updateTodoItem)
  const removeTodoItem = useStore((s) => s.removeTodoItem)
  const toggleTodoItemDone = useStore((s) => s.toggleTodoItemDone)

  return (
    <div
      className={`ctodo-item${item.done ? ' done' : ''}${dragging ? ' dragging' : ''}${flow ? ' flow' : ''}`}
      style={style}
      onClick={() => !editing && onOpenLightbox()}
    >
      <button
        className="ctodo-check"
        data-tip={item.done ? '标为未完成' : '标为完成'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          toggleTodoItemDone(boardId, item.id)
        }}
      >
        {item.done && <CheckIcon size={11} />}
      </button>

      {editing ? (
        <input
          className="ctodo-item-rename"
          defaultValue={item.title}
          placeholder="待办标题…"
          autoFocus
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            updateTodoItem(boardId, item.id, { title: e.target.value.trim() || '未命名待办' })
            onDoneEditing()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') onDoneEditing()
          }}
        />
      ) : (
        <span className="ctodo-item-title">{item.title || '未命名待办'}</span>
      )}

      {!flow && (
        <span
          className="ctodo-handle"
          data-tip="拖拽排序"
          onMouseDown={onHandleMouseDown}
          onClick={(e) => e.stopPropagation()}
        >
          <GripDots />
        </span>
      )}

      <button
        className="ctodo-item-x"
        data-tip="删除待办"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          removeTodoItem(boardId, item.id)
        }}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  )
}

function TodoLightbox({
  boardId,
  item,
  onClose
}: {
  boardId: string
  item: TodoItem
  onClose: () => void
}): JSX.Element {
  /** 详情框是非受控的（defaultValue + onBlur），语音要往里追加就得拿到它 */
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const updateTodoItem = useStore((s) => s.updateTodoItem)
  const [open, setOpen] = useState(false)
  const closingRef = useRef(false)

  // 挂载后下一帧才加 .open——从「刚挂载、动效起点」跳到「目标态」之间必须隔一帧，
  // 不然浏览器会把两次样式变化合并成一次，直接跳到终态、没有动效可言。
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = (): void => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false) // 退场动效起播
    window.setTimeout(onClose, LIGHTBOX_EXIT_MS) // 播完再真正卸载
  }

  return createPortal(
    <div
      className={`ctodo-lightbox-overlay${open ? ' open' : ''}`}
      onMouseDown={close}
    >
      <div className="ctodo-lightbox" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ctodo-lightbox-head">
          <input
            className="ctodo-lightbox-title"
            defaultValue={item.title}
            placeholder="待办标题…"
            onBlur={(e) => updateTodoItem(boardId, item.id, { title: e.target.value.trim() || '未命名待办' })}
          />
          <button className="ctodo-lightbox-x" data-tip="关闭" onClick={close}>
            <CloseIcon size={13} />
          </button>
        </div>
        {/* 文本框和语音钮包一层：语音钮要**绝对定位在文本框右下角内侧**。
            原来靠 margin-top:-34px 硬拽，实测落在框外（右 -10px、下 -8px），
            还把灯箱底部的留白吃掉了 —— 文本框底到灯箱底只剩 9px，头重脚轻。 */}
        <div className="ctodo-lightbox-field">
          <textarea
            ref={bodyRef}
            className="ctodo-lightbox-body"
            defaultValue={item.body ?? ''}
            placeholder="写点详细信息…（也可以按住麦克风说）"
            autoFocus
            onBlur={(e) => updateTodoItem(boardId, item.id, { body: e.target.value })}
          />
          {/* 语音写详情。**说完立刻存盘，不等 blur** —— 上面那个 textarea 是非受控的，
              语音是直接往 DOM 里追加，React 不知道值变了；只靠 onBlur 的话，
              说完直接关掉灯箱就丢了。 */}
          <div className="ctodo-lightbox-voice">
            <VoiceButton
              ptyId={`todo-${item.id}`}
              inline
              onText={(t) => {
                const el = bodyRef.current
                if (!el) return
                el.value = el.value ? `${el.value}${/\s$/.test(el.value) ? '' : ' '}${t}` : t
                updateTodoItem(boardId, item.id, { body: el.value })
                el.focus()
              }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
