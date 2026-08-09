// 挂在某个终端输入框上方的待办清单面板。纯展示 + 交互，数据和存储都在 useTerminalTodos 里。
//
// 打钩这件事**完全是用户自己点**——不解析终端输出、不代 agent 判断「这条做完了没」。
// 这是产品上明确定过的：agent 说完成了 和 事情真的做完了 是两回事，这个组件不参与判断。
import { useRef, useState } from 'react'
import type { TerminalTodos } from './useTerminalTodos'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon, TrashIcon } from '../../ui/Icons'

export function TerminalTodoPanel({ todos }: { todos: TerminalTodos }): JSX.Element | null {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const addRef = useRef<HTMLInputElement>(null)

  // 还没插入过清单：不占地方，右键菜单是唯一入口
  if (!todos.exists) return null

  const done = todos.items.filter((it) => it.done).length

  const commitAdd = (): void => {
    const t = draft.trim()
    if (!t) return
    todos.addItem(t)
    setDraft('')
    // 连续加好几条是常态，加完把焦点留在输入框上
    requestAnimationFrame(() => addRef.current?.focus())
  }

  return (
    <div className="term-todo">
      {/* 头部不能整体做成一个 <button>——里面还挂着「删除清单」这个独立的可点击控件，
          按钮套按钮是无效 HTML，键盘可达性也会乱。拆成「展开区」+「删除」两个平级按钮 */}
      <div className="term-todo-hd">
        <button
          className="term-todo-toggle"
          onClick={() => todos.setExpanded(!todos.expanded)}
          data-tip={todos.expanded ? '收起' : '展开'}
        >
          {todos.expanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          <span className="term-todo-title">待办</span>
          <span className="term-todo-count">
            {done}/{todos.items.length}
          </span>
        </button>
        <button className="term-todo-del" data-tip="删除这份清单" onClick={() => todos.removeList()}>
          <TrashIcon size={11} />
        </button>
      </div>

      {todos.expanded && (
        <div className="term-todo-body">
          {todos.items.length > 0 && (
            <div className="term-todo-list">
              {todos.items.map((it) => (
                <div className={`term-todo-item${it.done ? ' done' : ''}`} key={it.id}>
                  <button
                    className="term-todo-check"
                    aria-label={it.done ? '取消勾选' : '勾选'}
                    onClick={() => todos.toggleItem(it.id)}
                  >
                    {it.done && <CheckIcon size={10} />}
                  </button>
                  {editingId === it.id ? (
                    <input
                      className="term-todo-edit"
                      defaultValue={it.text}
                      autoFocus
                      spellCheck={false}
                      onBlur={(e) => {
                        const t = e.target.value.trim()
                        // 编辑成空文本等于放弃这次改名，原文保留——不能让条目变成空行
                        if (t) todos.editItem(it.id, t)
                        setEditingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                  ) : (
                    <span
                      className="term-todo-text"
                      onDoubleClick={() => setEditingId(it.id)}
                      data-tip="双击改文字"
                    >
                      {it.text}
                    </span>
                  )}
                  <button
                    className="term-todo-x"
                    aria-label="删除这一条"
                    onClick={() => todos.removeItem(it.id)}
                  >
                    <CloseIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="term-todo-add">
            <input
              ref={addRef}
              placeholder="加一条待办…"
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitAdd()
                }
              }}
            />
            <button
              className="term-todo-addbtn"
              aria-label="加一条"
              disabled={!draft.trim()}
              onMouseDown={(e) => {
                // 同发送按钮的取舍：mousedown 而不是 click，避免输入框先失焦
                e.preventDefault()
                commitAdd()
              }}
            >
              <PlusIcon size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
