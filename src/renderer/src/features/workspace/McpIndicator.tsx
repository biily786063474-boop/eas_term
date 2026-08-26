// MCP 指示灯：AI（Claude Code / Codex）通过 MCP 动画板时，标题栏这个插头亮一下。
// 目的是「看得见」——AI 在后台开预览、整理、发通知，用户得知道刚才发生了什么，
// 以及能一键掐断（关掉后所有工具调用立刻被拒，不用去改 ~/.claude.json）。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  return `${Math.floor(d / 3600)}h`
}

export function McpIndicator(): JSX.Element | null {
  const mcpLog = useStore((s) => s.mcpLog)
  const mcpEnabled = useStore((s) => s.mcpEnabled)
  const setMcpEnabled = useStore((s) => s.setMcpEnabled)
  const clearMcpLog = useStore((s) => s.clearMcpLog)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [flash, setFlash] = useState(false)
  const lastId = useRef(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 新调用进来 → 闪一下（1.2s 后熄）
  useEffect(() => {
    const top = mcpLog[0]
    if (!top || top.id === lastId.current) return
    lastId.current = top.id
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [mcpLog])

  // 点外面收起
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // 从没被调用过、且没关过开关 → 完全不占标题栏空间
  if (!mcpLog.length && mcpEnabled) return null

  return (
    <>
      <button
        ref={btnRef}
        className={`tb-item mcp-ind${flash ? ' flash' : ''}${mcpEnabled ? '' : ' off'}`}
        data-tip={mcpEnabled ? 'AI 正在通过 MCP 操作画板，点击查看' : 'MCP 已关闭，点击查看'}
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setPos({ x: Math.max(8, r.right - 300), y: r.bottom + 6 })
          setOpen((v) => !v)
        }}
      >
        MCP
        {!!mcpLog.length && <span className="tb-badge">{mcpLog.length}</span>}
      </button>
      {/* 弹窗必须 portal 到 body：标题栏是 overflow:hidden 会把它裁掉，
          画布里的 webview 遮罩层也会盖住标题栏内的绝对定位元素 */}
      {open &&
        createPortal(
          <div className="mcp-pop" ref={popRef} style={{ left: pos.x, top: pos.y }}>
            <div className="mcp-pop-head">
              <span>MCP 接入</span>
              <label className="mcp-toggle">
                <input
                  type="checkbox"
                  checked={mcpEnabled}
                  onChange={(e) => setMcpEnabled(e.target.checked)}
                />
                <span>{mcpEnabled ? '已开启' : '已关闭'}</span>
              </label>
            </div>
            <div className="mcp-pop-list">
              {mcpLog.length ? (
                mcpLog.map((e) => (
                  <div key={e.id} className={`mcp-row${e.ok ? '' : ' bad'}`}>
                    <span className="mcp-row-tool">{e.tool}</span>
                    <span className="mcp-row-detail">{e.detail}</span>
                    <span className="mcp-row-at">{ago(e.at)}</span>
                  </div>
                ))
              ) : (
                <div className="mcp-empty">还没有调用记录</div>
              )}
            </div>
            {!!mcpLog.length && (
              <button className="mcp-clear" onClick={clearMcpLog}>
                清空记录
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
