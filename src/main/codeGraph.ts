// 代码可视化的 IPC 口。**分析逻辑在 `codeGraphAnalyze.ts`**（零 electron 依赖，可单测）——
// 这里只负责把渲染层的请求接过去，以及那道「传进来的路径可不可信」的门槛。

import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { analyzeProject } from './codeGraphAnalyze.ts'

export function registerCodeGraphHandlers(): void {
  ipcMain.handle('codeGraph:analyze', async (_e, raw: unknown) => {
    const root = typeof raw === 'string' ? raw : ''
    // **只扫真实存在的目录。** 路径来自渲染层，按 fsGuard 的同一条纪律：
    // 不信任传入路径，先落到「它必须是一个存在的目录」这道最低门槛上。
    if (!root || !fs.existsSync(path.join(root, 'package.json'))) {
      return { ok: false as const, error: '这个目录看起来不是一个 Node 项目（没有 package.json）' }
    }
    try {
      return { ok: true as const, graph: await analyzeProject(root) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
