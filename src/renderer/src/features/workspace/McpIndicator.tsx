// MCP 调用记录（设置 › MCP 接入那一段）。
//
// ── 2026-08-31：记录和开关搬进了设置，标题栏只留一盏会闪的灯 ──────────
// ── 2026-09-14：那盏灯也拆了 ──────────────────────────────────────────
// 用户要标题栏不常驻任何运行态入口。「MCP 关着却有调用被拒」这种真需要当场知道的事，
// 由 TitlebarAlert.tsx 的临时提示承接（有事才出现）；平时的调用记录来这里看。
// 文件名没改：SettingsPanel 引的是这里的 McpBody。
import { useStore } from '../../store'

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  return `${Math.floor(d / 3600)}h`
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
