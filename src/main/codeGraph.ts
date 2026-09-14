// 代码可视化的 IPC 口。**分析逻辑在 `codeGraphAnalyze.ts`**（零 electron 依赖，可单测）——
// 这里只负责把渲染层的请求接过去，以及那道「传进来的路径可不可信」的门槛。

import { guardedHandle } from './ipcGuard'
import {sharedServices} from './runtime/sharedServices.ts'
import {projectAttribution} from './runtime/projectAttribution.ts'
import {loadProjects} from './projects'
import {cancelSessionStartsForWindow} from './runtime/sessionStartup.ts'
import {observeSharedWindow} from './runtime/sharedWindowLifecycle.ts'
import fs from 'node:fs'

import { analyzeProject } from './codeGraphAnalyze.ts'
import { analyzeSymbolsManaged } from './managedSymbols.ts'
import os from 'node:os'

/** 「这个路径能不能扫」。**两个 handler 共用一份** ——
 *  各写一遍的话，以后收紧了其中一处，另一处会一直松着。
 *  返回 null = 过了；返回对象 = 直接把它回给渲染层。 */
export function checkRoot(root: string): { ok: false; error: string } | null {
  if (!root) return { ok: false, error: '没有指定项目目录' }
  let stat: fs.Stats
  try {
    stat = fs.statSync(root)
  } catch {
    return { ok: false, error: '这个目录不存在了 —— 可能被移走或改名了' }
  }
  if (!stat.isDirectory()) return { ok: false, error: '这不是一个目录' }
  return null
}

export function registerCodeGraphHandlers(): void {
  guardedHandle('codeGraph:analyze', async (_e, raw: unknown) => {
    const root = typeof raw === 'string' ? raw : ''
    // **只扫真实存在的目录。** 路径来自渲染层，按 fsGuard 的同一条纪律：
    // 不信任传入路径，先落到「它必须是一个存在的目录」这道最低门槛上。
    //
    // ⚠️ 这里原来要求必须有 `package.json`。**那道门槛拦错了人** ——
    // 2026-09-03 实测用户 29 个项目里 20 个没有 package.json，其中不少是
    // 纯前端 / 一堆脚本的项目，代码地图本来完全画得出来。
    // 判据改成「是不是一个存在的目录」，有没有源码交给分析器去说
    //（它会给出一句人话，而不是在这儿一刀切）。
    const gate = checkRoot(root)
    if (gate) return gate
    try {
      return { ok: true as const, graph: await analyzeProject(root) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 符号级（第一期：文件内结构 ＋ 死代码清单）。
  // **和模块级共用同一道门槛**，不另写一遍「这个路径可不可信」。
  guardedHandle('codeGraph:symbols', async (_e, raw: unknown) => {
    const root = typeof raw === 'string' ? raw : ''
    const gate = checkRoot(root)
    if (gate) return gate
    try {
      // 2026-09-13：提取搬进独立 Worker（tsSymbolsWorker.ts），按窗口归属经 runManagedTask 准入。
      // 原先在主进程同步 ts.createProgram，大项目整个界面冻几秒；现在主线程只等消息，
      // 取消 = terminate，预算随线程 exit 释放。工厂由 ?nodeWorker 打包，动态 import 只为不在启动期加载它。
      const { createSymbolsWorker } = await import('./tsSymbolsHost.ts')
      // 重新解析时把邻域那侧的 Program 缓存也丢掉 —— **两处各存一份 Program，
      // 只清一处的话「重新解析」之后邻域仍然是旧的**，而界面上看不出来
      const { dropTsCache } = await import('./tsProvider.ts')
      dropTsCache(root)
      // 语言服务器那侧也要清 —— **三处各存一份状态，只清一处的话**
      // 「重新解析」之后邻域仍然是旧的，而界面上看不出来
      const { dropLspClients } = await import('./lspProvider.ts')
      dropLspClients(root, _e.sender.id)
      const graph = await analyzeSymbolsManaged({
        root, windowId: _e.sender.id, projectId: projectAttribution(root, loadProjects()),
        // 一个核跑满 + TS Program 内存：估算，不是实测峰值。
        cost: { cpu: Math.max(7, 100 / Math.max(1, os.availableParallelism())), memoryBytes: 768 * 1024 ** 2 },
        createWorker: workerData => createSymbolsWorker({ workerData })
      })
      return { ok: true as const, graph }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 各语言服务器装没装、要不要项目配置。**界面上如实列出来** ——
  // 没装就说「装了 X 才能画 Y」，不静默降级。
  guardedHandle('codeGraph:providers', async (_e, raw: unknown) => {
    const root = typeof raw === 'string' ? raw : ''
    const gate = checkRoot(root)
    if (gate) return gate
    try {
      const { lspProviders } = await import('./lspProvider.ts')
      const { TS_EXTENSIONS } = await import('./tsProvider.ts')
      return {
        ok: true as const,
        providers: [
          { name: 'TypeScript（内置）', extensions: TS_EXTENSIONS, status: 'ready' as const },
          ...lspProviders(root)
        ]
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 邻域：谁调用了这个 / 这个调用了谁（第二期）。
  // **按 LSP 的形状收参**（0-based 行列）—— 见 `shared/symbolProvider.ts` 的文件头：
  // 以后接 clangd / sourcekit-lsp / pyright 时，这个 handler 只需要按扩展名
  // 换一个 provider，入参出参一个字不用改。
  guardedHandle('codeGraph:neighborhood', async (_e, raw: unknown) => {
    const p = (raw ?? {}) as { root?: unknown; ref?: unknown }
    const root = typeof p.root === 'string' ? p.root : ''
    const gate = checkRoot(root)
    if (gate) return gate
    const r = p.ref as { file?: unknown; line?: unknown; character?: unknown; name?: unknown } | undefined
    if (
      !r ||
      typeof r.file !== 'string' ||
      typeof r.line !== 'number' ||
      typeof r.character !== 'number' ||
      typeof r.name !== 'string'
    ) {
      // params 来自渲染层（unknown）。形状不对一律当没给 —— 不猜、不修补
      return { ok: false as const, error: '符号定位参数不完整' }
    }
    try {
      // ── 挑 provider：TS 走内置，其余走语言服务器 ────────────────────────
      // **这段就是第二期把抽象按 LSP 形状定死换来的** ——
      // 两条路的入参出参一模一样，这里只是按扩展名分流。
      const { tsNeighborhood, TS_EXTENSIONS } = await import('./tsProvider.ts')
      const ext = r.file.slice(r.file.lastIndexOf('.')).toLowerCase()
      const ref = { file: r.file, line: r.line, character: r.character, name: r.name }
      if (TS_EXTENSIONS.includes(ext)) {
        // TS 不走 LSP：已经在依赖里的 typescript 包更快更准，且不用起进程
        const n = tsNeighborhood(root, ref)
        if (!n) return { ok: false as const, error: '在那个位置找不到符号 —— 文件可能改过了，试试重新解析' }
        return { ok: true as const, neighborhood: n }
      }
      const { lspNeighborhood } = await import('./lspProvider.ts')
      if (_e.sender.isDestroyed()) return {ok:false as const,error:'窗口已关闭'}
      observeSharedWindow(_e.sender,id=>{cancelSessionStartsForWindow(id);sharedServices.releaseWindow(id)})
      return await lspNeighborhood(root, ref, {windowId:_e.sender.id,projectId:projectAttribution(root,loadProjects())})
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
