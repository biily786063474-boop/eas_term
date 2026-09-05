// 在主进程里找一个能跑纯脚本的 node。**GUI 启动的 app PATH 很贫瘠**（launchd 给的
// /usr/bin:/bin:…，没有 /opt/homebrew/bin），`spawn('node')` 直接 ENOENT ——
// 2026-09-05 正式版插件面板就是这么倒的（隔离实例从 shell 起、PATH 全，没暴露）。
// 所以是**探固定路径**而不是 which；都没有就用 app 自带的 Electron 以 node 模式跑，
// 任何机器上都能起。mcpBridge 的 MCP shim 和 pluginHost 的插件进程共用这一份。
import fs from 'node:fs'

export interface NodeRunner {
  command: string
  args: string[]
  env?: Record<string, string>
}

export const NODE_CANDIDATES = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'] as const

/**
 * @param scriptArgs 传给 node 的参数（脚本路径在前）
 * @param opts.exists 注入探测函数（测试用）；`electron` 是回退用的可执行文件（process.execPath）
 */
export function nodeRunner(
  scriptArgs: string[],
  opts: { exists?: (p: string) => boolean; electron: string; platform?: NodeJS.Platform } = { electron: process.execPath }
): NodeRunner {
  const exists = opts.exists ?? ((p: string): boolean => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
  const platform = opts.platform ?? process.platform
  if (platform !== 'win32') for (const c of NODE_CANDIDATES) if (exists(c)) return { command: c, args: scriptArgs }
  return { command: opts.electron, args: scriptArgs, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** 插件清单里 `mcp.command` 写的是裸 `node` 时，替它解析成能起来的那个 */
export function resolveCommand(command: string, args: string[], opts?: Parameters<typeof nodeRunner>[1]): NodeRunner {
  if (command === 'node' || command === 'node.exe') return nodeRunner(args, opts)
  return { command, args }
}
