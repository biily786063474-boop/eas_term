// MCP 指示灯 + 调用记录。
//
// ── 2026-08-31：记录和开关搬进了设置，标题栏只留那盏灯 ──────────────
// 用户要「MCP 调用记录放到设置里」。但**这盏灯不能一起搬走** ——
// 它存在的全部理由是「看得见」：AI 在后台开预览、整理、发通知时，
// 你得当场知道刚才发生了什么。搬进设置就等于没人看得见了。
//
// 所以拆成两半：标题栏留一盏会闪的灯（点它跳到设置 → AI 对话），
// 记录列表和总开关搬进设置那一栏（McpBody）。
import { useEffect, useRef, useState } from 'react'
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
  const [flash, setFlash] = useState(false)
  const lastId = useRef(0)
  const btnRef = useRef<HTMLButtonElement>(null)

  // 新调用进来 → 闪一下（1.2s 后熄）
  useEffect(() => {
    const top = mcpLog[0]
    if (!top || top.id === lastId.current) return
    lastId.current = top.id
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [mcpLog])

  // 从没被调用过、且没关过开关 → 完全不占标题栏空间
  if (!mcpLog.length && mcpEnabled) return null

  return (
    <button
      ref={btnRef}
      className={`tb-item mcp-ind${flash ? ' flash' : ''}${mcpEnabled ? '' : ' off'}`}
      data-tip={mcpEnabled ? 'AI 正在通过 MCP 操作画板，点击查看记录' : 'MCP 已关闭，点击查看'}
      onClick={() =>
        window.dispatchEvent(new CustomEvent('eas:open-settings', { detail: { tab: 'ai' } }))
      }
    >
      MCP
      {!!mcpLog.length && <span className="tb-badge">{mcpLog.length}</span>}
    </button>
  )
}

/** 设置 →「AI 对话」里那一段：总开关 + 调用记录。
 *  **不带自己的弹层容器** —— 它现在长在设置的分区里，外壳由那边给。 */
export function McpBody(): JSX.Element {
  const mcpLog = useStore((s) => s.mcpLog)
  const mcpEnabled = useStore((s) => s.mcpEnabled)
  const setMcpEnabled = useStore((s) => s.setMcpEnabled)
  const clearMcpLog = useStore((s) => s.clearMcpLog)
  return (
    <>
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
      {/* **关掉之后要说清后果** —— 光一个开关不解释，用户不知道关了会怎样 */}
      <div className="cset-note">
        关掉之后 AI 通过 MCP 发来的调用一律被拒（不用去改 ~/.claude.json）。
        下面是它动过什么。
      </div>
      <div className="mcp-pop-list in-settings">
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
        <button className="cset-btn" onClick={clearMcpLog}>
          清空记录
        </button>
      )}
    </>
  )
}
