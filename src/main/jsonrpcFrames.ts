// MCP stdio 传输的帧：一行一条 JSON-RPC。**纯函数，零依赖。**
// 给 mcpClient.ts（宿主连插件 server）用。半包 / 粘包 / 非法行都要扛得住 ——
// 子进程 stdout 的切块和消息边界毫无关系。

export interface SplitResult {
  /** 完整的行（已去掉换行），按顺序 */
  lines: string[]
  /** 没收完的尾巴，下次拼在新块前面 */
  rest: string
}

export function splitFrames(rest: string, chunk: string): SplitResult {
  const buf = rest + chunk
  const parts = buf.split('\n')
  const tail = parts.pop() ?? ''
  return { lines: parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0), rest: tail }
}

/** 解析一行。不是合法 JSON 对象就返回 null —— 调用方跳过、记一笔，不抛。 */
export function parseFrame(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function encodeFrame(msg: unknown): string {
  return JSON.stringify(msg) + '\n'
}

/** 这条消息是响应（有 id 且有 result/error）、请求（有 id 有 method）还是通知（无 id 有 method） */
export function classify(m: Record<string, unknown>): 'response' | 'request' | 'notification' | 'unknown' {
  const hasId = m.id !== undefined && m.id !== null
  if (typeof m.method === 'string') return hasId ? 'request' : 'notification'
  if (hasId && ('result' in m || 'error' in m)) return 'response'
  return 'unknown'
}
