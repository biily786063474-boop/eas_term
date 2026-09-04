// 邻域视图的**契约**：「谁调用了这个 / 这个调用了谁」。
//
// ── 为什么要有这一层抽象（用户 2026-09-03 拍的板）────────────────────────────
// 第一期的符号分析直接调 TypeScript Compiler API。要加 Python / C / Swift 时，
// 正确做法不是各写一套解析，而是**接现成的语言服务器**（LSP）——
// 那边有标准方法：`callHierarchy/incomingCalls` / `outgoingCalls` /
// `textDocument/documentSymbol`，clangd 与 sourcekit-lsp 本机就有（随 Xcode），
// 握手确认都支持，并且用一个三层调用的 C 文件端到端验过。
//
// 所以这一层按 **LSP 的形状**定，TS 那条作为「内置 provider」接进来。
// 加一门语言 = 加一条配置（可执行文件名 ＋ 启动参数），不是加一套解析器。
//
// ⚠️ **这个抽象必须在第二期就定死。** 第三期（更多语言）再改的话，
// 每个已接入的 provider 都要跟着改一遍。

import type { SymbolNode } from './symbolGraph.ts'

/** 定位一个符号。**够 LSP 用**：它的 `prepareCallHierarchy` 要的就是
 *  「哪个文件的哪一行哪一列」。行列都是 **0-based**（LSP 的约定），
 *  和 `SymbolNode.line`（1-based，给人看的）差一 —— 转换只许有一处，见 `refOf`。 */
export interface SymbolRef {
  file: string
  /** 0-based（LSP 约定） */
  line: number
  /** 0-based。指向**符号名的起始列** —— LSP 要求落在名字上，落在 `function` 关键字上会拿不到 */
  character: number
  /** 名字。TS provider 用它当键；LSP 那侧只用来显示 */
  name: string
}

/** 从给人看的 `SymbolNode` 换成给 LSP 用的 `SymbolRef`。
 *  **1-based → 0-based 的转换只许在这一处发生** ——
 *  两处各转一次的结果是差一行，而差一行拿到的是别的符号（或者什么都拿不到）。 */
export function refOf(sym: SymbolNode, character?: number): SymbolRef {
  // **默认用符号自己记的列**，不要用 0 —— 缩进过的符号（类里的方法、嵌套函数）
  // 第 0 列是空白，落不到标识符上，LSP 和 TS checker 都会返回空
  return { file: sym.file, line: sym.line - 1, character: character ?? sym.character, name: sym.name }
}

/** 一个调用点。 */
export interface CallSite {
  /** 调用方（或被调方）那个符号 */
  symbol: SymbolNode
  /** 调用发生在哪几行（1-based，给人看的）。同一对符号之间可能调用多次 */
  lines: number[]
}

/** 一个符号的邻域。 */
export interface Neighborhood {
  center: SymbolNode
  /** 谁调用了它 */
  incoming: CallSite[]
  /** 它调用了谁 */
  outgoing: CallSite[]
  /** 有没有被截断（邻居太多时只取前 N 个） */
  truncated: boolean
  /** 这份结果是谁给的。界面上要如实说 —— 不同 provider 的准确率差很远 */
  provider: string
}

/** 邻域最多画多少个邻居。**超过就截断并如实说**。
 *  30 是环形图上标签还读得清的上限（模块级下钻用的是 24，符号名更短所以放宽一点）。 */
export const NEIGHBOR_MAX = 30

/** 把一堆调用点按「调用次数」排序并截断。
 *  **截断要从少的那头砍** —— 调用得最多的那几个才是「动了会伤到谁」的答案。 */
export function rankAndTrim(
  sites: readonly CallSite[],
  max = NEIGHBOR_MAX
): { sites: CallSite[]; truncated: boolean } {
  const sorted = [...sites].sort(
    (a, b) => b.lines.length - a.lines.length || a.symbol.id.localeCompare(b.symbol.id)
  )
  return { sites: sorted.slice(0, max), truncated: sorted.length > max }
}

/** 一个语言 provider 能不能处理这个文件，以及它是谁。 */
export interface ProviderInfo {
  /** 显示名（界面上要说清结果是谁给的） */
  name: string
  /** 它认哪些扩展名 */
  extensions: string[]
  /** 就绪状态。`missing` 时界面要说「装了 X 才能画 Y 的调用图」，**不要静默降级** */
  status: 'ready' | 'missing' | 'error'
  /** status 不是 ready 时，给用户看的一句人话 */
  detail?: string
}

/** 按扩展名挑 provider。**第一个认得的胜出** —— 顺序即优先级。 */
export function providerFor(
  file: string,
  providers: readonly ProviderInfo[]
): ProviderInfo | null {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  return providers.find((p) => p.extensions.includes(ext)) ?? null
}
