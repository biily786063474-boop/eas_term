// 非零退出原因优先使用结构化服务端错误；MCP 的收尾警告不覆盖真正失败原因。
const NOISE = [/^Reading additional input from stdin/i, /^\s*$/, /failed to initialize MCP client during shutdown/i]
const MCP_FAILURE = /MCP startup failed|handshaking with MCP server failed|MCP client for .+ failed to start/i

export function friendlyCliError(message: string): string {
  const model = message.match(/The '([^']+)' model requires a newer version of Codex/i)?.[1]
  return model ? `当前 Codex CLI 版本过旧，无法使用 ${model}。请升级 Codex CLI 后重试。` : message
}

function candidate(line: string): { score: number; text: string } | undefined {
  if (NOISE.some(re => re.test(line))) return undefined
  const text = line.trim().replace(/^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+)?(?:ERROR|WARN|INFO)\s+[\w:]+:\s*/i, '')
  // Codex prewarm 把服务端错误 JSON 嵌在日志前缀后；message 才是操作原因。
  const start = text.indexOf('{')
  if (start >= 0) {
    try {
      const data = JSON.parse(text.slice(start))
      const message = data?.error?.message
      if (typeof message === 'string' && message) return { score: 4, text: friendlyCliError(message) }
    } catch { /* 普通文本仍按日志级别处理 */ }
  }
  return { score: /\bERROR\b/.test(line) ? 3 : /\b(?:WARN|INFO)\b/.test(line) ? 1 : 2, text: friendlyCliError(text) }
}

/** 流式诊断有界缓存；保存最佳原因，避免后续长日志把它挤出 stderr 尾巴。 */
export function createStderrDiagnostics(): { push: (chunk: string) => boolean; reason: () => string } {
  let pending = ''
  let best: { score: number; text: string } | undefined
  let mcpNoticed = false
  const accept = (line: string): void => {
    const next = candidate(line)
    if (next && (!best || next.score >= best.score)) best = { ...next, text: next.text.slice(0, 2000) }
  }
  return {
    push(chunk) {
      const combined = pending + chunk
      const warn = !mcpNoticed && MCP_FAILURE.test(combined)
      if (warn) mcpNoticed = true
      const lines = combined.split(/\r?\n/)
      pending = (lines.pop() ?? '').slice(-16384)
      for (const line of lines) accept(line)
      return warn
    },
    reason() { accept(pending); return best?.text ?? '' }
  }
}

export function stderrReason(tail: string, max = 160): string {
  const diagnostics = createStderrDiagnostics()
  diagnostics.push(tail)
  const why = diagnostics.reason()
  return why.length > max ? why.slice(0, max - 1) + '…' : why
}

export function exitMessage(code: number, tail: string): string {
  const why = stderrReason(tail)
  return why ? `CLI 进程退出（code ${code}）：${why}` : `CLI 进程退出（code ${code}）`
}
