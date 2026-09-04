// 符号级代码地图的**纯判定层**：可信度、死代码定性、符号分类。
//
// 零依赖（不 import ts / fs / electron），`node --test` 直接跑。
// 抽在这里的理由和 `codeGraph.ts` 一样：这几个判断错了的表现极其隐蔽 ——
// 图照画、清单照出，只是内容错的。而它们全部来自实测踩到的坑
//（见 `docs/代码地图-AST符号级可视化-可行性与设计.html` 第三节）。

/** 一个符号（函数 / 方法 / 类 / 变量形式的函数）。 */
export interface SymbolNode {
  /** `文件相对路径#符号名`。同名符号在不同文件里靠前缀区分 */
  id: string
  file: string
  name: string
  kind: 'function' | 'method' | 'class' | 'arrow' | 'other'
  /** 起始行（1-based），点进去要用 */
  line: number
  /** **符号名**的起始列（0-based）。
   *
   *  ⚠️ 不是声明的起始列 —— LSP 的 `prepareCallHierarchy` 要求位置落在**名字**上，
   *  落在 `function` 关键字或缩进的空白上会拿不到符号。
   *  一开始 `refOf` 默认传 0，于是所有缩进过的符号（类里的方法、嵌套函数）
   *  全部查不到邻域，报「在那个位置找不到符号」（2026-09-03 真机撞到）。 */
  character: number
  exported: boolean
  /** 被本仓库引用了多少次（**不只是调用点**） */
  refs: number
  /** 是不是**模块顶层**的声明。
   *
   *  ⚠️ **只有顶层的能进死代码清单。** 对象字面量里的方法（`return { write() {…} }`）
   *  几乎总是某个接口成员的实现 —— 调用方引的是**接口那侧的声明**，
   *  和实现处是两个不同的 declaration，`文件#名字` 这个键对不上，
   *  于是每一个接口实现都会被判成死代码。
   *  2026-09-03 实测本仓库：27 条「死代码」里 20 条是这么来的
   *（`adapters/*.ts` 的 buildArgs、`omp/launch.ts` 的 write/onLine/kill…）。
   *  它们仍然出现在**文件内结构图**里 —— 那是有用的信息，只是不该当死代码报。 */
  topLevel: boolean
}

/** 一条「谁用了谁」的边。 */
export interface SymbolEdge {
  from: string
  to: string
}

// ── 可信度 ──────────────────────────────────────────────────────────────────
//
// 坑 3：`checkJs:false` 的区域，TypeScript 的符号解析**不报错、只是解不出来**。
// 实测本仓库 design 模块那片 `.jsx`：24 条死代码里 8 条是它贡献的假阳性。
// 一个 33% 误报的清单比没有更糟 —— 用户会开始不信它，然后连真的那几条也漏掉。

/** 这个文件的分析结果可不可信。
 *
 *  @param file       相对路径
 *  @param checkedJs  当前 tsconfig 是不是开了 `checkJs`
 */
export function isTrustworthy(file: string, checkedJs: boolean): boolean {
  const isJs = /\.(js|jsx|mjs|cjs)$/i.test(file)
  return !isJs || checkedJs
}

/** 不可信的原因（给界面显示）。可信时返回 null。 */
export function untrustReason(file: string, checkedJs: boolean): string | null {
  if (isTrustworthy(file, checkedJs)) return null
  return 'tsconfig 里 checkJs 是 false，TypeScript 不检查这个文件 —— 符号解析会静默失效'
}

// ── 死代码定性 ──────────────────────────────────────────────────────────────

/** 判死代码时要豁免的那些。
 *
 *  **它们「没人调用」是正常的**，不是死代码：
 *  · `register*Handlers` 之流由 index.ts 在启动时调一次 —— 那个调用点在的话不会进这里，
 *    但被豁免的是**入口本身**（`main` / 默认导出的组件之类）。
 *  · 测试文件里的东西不算（调用方是测试运行器，不是代码）。
 *  · `_` 开头是约定俗成的「我知道它现在没人用」。 */
export function isDeadCodeExempt(sym: Pick<SymbolNode, 'file' | 'name'>): boolean {
  if (sym.file.includes('.test.') || sym.file.includes('.spec.')) return true
  if (sym.name.startsWith('_')) return true
  // 构建/配置文件里的导出是给工具读的，没有仓库内调用点很正常
  if (/(^|\/)(vite|electron\.vite|tsconfig|eslint|tailwind)[.\w-]*\.(ts|js|mjs|cjs)$/i.test(sym.file)) return true
  return false
}

/** 死代码的定性。
 *
 *  · `dead`      —— 确认没有任何引用，且文件可信
 *  · `unsure`    —— 没有引用，但这个文件的解析不可信（`checkJs:false` 区）
 *  · `exempt`    —— 按 `isDeadCodeExempt` 豁免
 *  · `alive`     —— 有引用
 */
export function deadCodeVerdict(
  sym: SymbolNode,
  checkedJs: boolean
): 'dead' | 'unsure' | 'exempt' | 'alive' {
  if (sym.refs > 0) return 'alive'
  // 非顶层的一律豁免 —— 理由见 `SymbolNode.topLevel` 的注释（接口实现会被误判）
  if (!sym.topLevel) return 'exempt'
  if (isDeadCodeExempt(sym)) return 'exempt'
  return isTrustworthy(sym.file, checkedJs) ? 'dead' : 'unsure'
}

// ── 文件内结构 ──────────────────────────────────────────────────────────────

/** 一个文件的符号 ＋ 它们之间的调用关系。文件内结构图的原料。 */
export interface FileStructure {
  file: string
  symbols: SymbolNode[]
  /** **只含文件内部**的边。跨文件的那些归邻域视图（第二期），不在这儿画 */
  edges: SymbolEdge[]
  trustworthy: boolean
}

/** 结果的形状。 */
export interface SymbolGraphResult {
  root: string
  /** 每个文件一份结构。按符号数从多到少排 */
  files: FileStructure[]
  /** 死代码清单（已按 `deadCodeVerdict` 分档） */
  dead: { sym: SymbolNode; verdict: 'dead' | 'unsure' }[]
  /** 扫了几个文件、几个符号 */
  stats: { files: number; symbols: number; refs: number }
  ms: number
  /** 不可信的文件数（`checkJs:false` 区）。界面上要如实说 */
  untrusted: number
}
