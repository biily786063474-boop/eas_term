// 代码可视化的 IPC 口。**分析逻辑在 `codeGraphAnalyze.ts`**（零 electron 依赖，可单测）——
// 这里只负责把渲染层的请求接过去，以及那道「传进来的路径可不可信」的门槛。

import { ipcMain } from 'electron'
import fs from 'node:fs'

import { analyzeProject } from './codeGraphAnalyze.ts'

export function registerCodeGraphHandlers(): void {
  ipcMain.handle('codeGraph:analyze', async (_e, raw: unknown) => {
    const root = typeof raw === 'string' ? raw : ''
    // **只扫真实存在的目录。** 路径来自渲染层，按 fsGuard 的同一条纪律：
    // 不信任传入路径，先落到「它必须是一个存在的目录」这道最低门槛上。
    //
    // ⚠️ 这里原来要求必须有 `package.json`。**那道门槛拦错了人** ——
    // 2026-09-03 实测用户 29 个项目里 20 个没有 package.json，其中不少是
    // 纯前端 / 一堆脚本的项目，代码地图本来完全画得出来。
    // 判据改成「是不是一个存在的目录」，有没有源码交给分析器去说
    //（它会给出一句人话，而不是在这儿一刀切）。
    if (!root) {
      return { ok: false as const, error: '没有指定项目目录' }
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(root)
    } catch {
      return { ok: false as const, error: '这个目录不存在了 —— 可能被移走或改名了' }
    }
    if (!stat.isDirectory()) {
      return { ok: false as const, error: '这不是一个目录' }
    }
    try {
      return { ok: true as const, graph: await analyzeProject(root) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
