import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { PlusIcon, CloseIcon } from './Icons'

function TabRenameInput({
  tabId,
  initial,
  onDone
}: {
  tabId: string
  initial: string
  onDone: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameTab = useStore((s) => s.renameTab)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    renameTab(tabId, value)
    onDone()
  }

  return (
    <input
      ref={inputRef}
      className="tab-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') onDone()
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

export function TabBar(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeTab = useStore((s) => s.closeTabSafely)
  const openTerminal = useStore((s) => s.openTerminal)
  const projects = useStore((s) => s.projects)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)

  // 只显示当前项目的标签
  const projectTabs = tabs.filter((t) => t.projectId === activeProjectId)

  return (
    <div className="tabbar">
      <div className="tabbar-tabs">
        {projectTabs.map((tab) => {
          const project = projects.find((p) => p.id === tab.projectId)
          return (
            <div
              key={tab.id}
              className={`tab${tab.id === activeTabId ? ' active' : ''}`}
              title={`${tab.cwd}\n双击重命名`}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => setEditingTabId(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(tab.id)
              }}
            >
              {project && <span className="tab-dot" />}
              {editingTabId === tab.id ? (
                <TabRenameInput
                  tabId={tab.id}
                  initial={tab.title}
                  onDone={() => setEditingTabId(null)}
                />
              ) : (
                <span className="tab-title">{tab.title}</span>
              )}
              <button
                className="tab-close"
                title="关闭标签页"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        className="tabbar-new"
        title="新建终端（⌘T）"
        onClick={() => void openTerminal()}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  )
}
