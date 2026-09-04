// 符号级代码地图的**提取层**：TypeScript Compiler API → 符号 ＋ 引用 ＋ 文件内调用。
//
// **零 electron**，`node --test` 直接跑（`tsSymbols.test.ts` 在临时目录里造真项目）。
// 判定全在 `shared/symbolGraph.ts`（纯函数、有测试）。
//
// ── 为什么用 typescript 而不是 tree-sitter ──────────────────────────────────
// `typescript` 已经在本项目的 devDependencies 里（5.6），**零新依赖**。
// 而且它带 checker：调用点解析率实测 96.6%，tree-sitter 只有语法树、
// 「这个 foo 是哪个 foo」答不了。实测账见
// `docs/代码地图-AST符号级可视化-可行性与设计.html`。
//
// ── 三个坑，全都写在下面对应的位置 ──────────────────────────────────────────
// 1. 不解 alias → 每条跨文件调用变自环（死代码假阳性 644 → 真实 24）
// 2. 只数 CallExpression → 回调式引用（`setInterval(fn)`）全被判成死代码
// 3. `checkJs:false` 的区域解析静默失效 → 必须标不可信，不能混进清单

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import {
  deadCodeVerdict,
  isTrustworthy,
  type FileStructure,
  type SymbolEdge,
  type SymbolGraphResult,
  type SymbolNode
} from '../shared/symbolGraph.ts'

export type { SymbolGraphResult }

/** 这个项目里有哪几份 tsconfig 要各建一个 Program。
 *
 *  **不能合成一个**：本仓库 `tsconfig.node.json`（主进程）与 `tsconfig.web.json`
 *  （渲染层）的编译选项和文件集都不同，合起来两边都错。 */
function tsconfigsOf(root: string): string[] {
  const named = ['tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.app.json', 'tsconfig.json']
  const hit = named.filter((n) => fs.existsSync(path.join(root, n)))
  // node/web 那两份存在时就不要再带上根 tsconfig —— 它多半只是个 references 壳子，
  // 建出来的 Program 是空的，白花几百毫秒
  const split = hit.filter((n) => n !== 'tsconfig.json')
  return split.length ? split : hit
}

/** **必须解别名。**
 *
 *  `import { foo } from './a'` 之后在本文件里调 `foo()`，
 *  `getSymbolAtLocation` 返回的符号，它的 `declarations[0]` 是**本文件里那条
 *  import 语句**，不是 `a.ts` 里的函数本体。不解的话：
 *   · 每条跨文件调用都变成自环（图上像「每个文件都高度内聚」）
 *   · 死代码清单里 644 个假阳性（真实数 24）—— 2026-09-03 实测 */
function realSymbol(checker: ts.TypeChecker, sym: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!sym) return undefined
  return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
}

/** 这个标识符是不是 **import 语句里的绑定名**（而不是一次真正的使用）。
 *
 *  `import { foo } from './a'` 里的那个 `foo` 不算「用了 foo」——
 *  只 import 却没用到的符号仍然是死的（TS 自己也会把它报成 unused import）。
 *
 *  ⚠️ **`export { foo } from './a'` 要算。** 再导出是把它放进了公开 API，
 *  谁都可能从这儿拿走 —— 判成死代码会误伤整个 re-export 桶文件。
 *  所以这里只挡 Import*，不挡 ExportSpecifier。 */
function isImportBinding(n: ts.Identifier): boolean {
  const p = n.parent
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true
  return false
}

/** 这个节点是不是一个「函数声明」，是的话返回名字与种类。 */
function declOf(n: ts.Node): { name: string; kind: SymbolNode['kind'] } | null {
  if (ts.isFunctionDeclaration(n) && n.name) return { name: n.name.text, kind: 'function' }
  if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return { name: n.name.text, kind: 'method' }
  if (ts.isClassDeclaration(n) && n.name) return { name: n.name.text, kind: 'class' }
  // `const foo = () => {}` / `const foo = function () {}`
  if (
    ts.isVariableDeclaration(n) &&
    ts.isIdentifier(n.name) &&
    n.initializer &&
    (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
  ) {
    return { name: n.name.text, kind: 'arrow' }
  }
  return null
}

/** 这个声明有没有被 export。 */
function isExported(n: ts.Node): boolean {
  let cur: ts.Node | undefined = n
  // 变量声明的 export 修饰在 VariableStatement 上，要往上找两层
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.canHaveModifiers(cur) && ts.getCombinedModifierFlags(cur as ts.Declaration) & ts.ModifierFlags.Export) {
      return true
    }
    if (ts.isVariableStatement(cur) || ts.isFunctionDeclaration(cur) || ts.isClassDeclaration(cur)) {
      if (ts.getCombinedModifierFlags(cur as ts.Declaration) & ts.ModifierFlags.Export) return true
      break
    }
    cur = cur.parent
  }
  return false
}

/** 这个声明是不是在**模块顶层**（而不是嵌在函数/对象字面量里）。
 *  只有顶层的进死代码清单，理由见 `SymbolNode.topLevel`。 */
function isTopLevel(n: ts.Node): boolean {
  // 变量声明要跳过 VariableDeclarationList / VariableStatement 那两层
  let cur: ts.Node | undefined = n.parent
  while (cur && (ts.isVariableDeclarationList(cur) || ts.isVariableStatement(cur))) cur = cur.parent
  return !!cur && ts.isSourceFile(cur)
}

/** 往上找这个节点属于哪个函数声明（文件内调用边的起点）。 */
function enclosingDecl(n: ts.Node): { name: string } | null {
  let cur: ts.Node | undefined = n.parent
  while (cur && !ts.isSourceFile(cur)) {
    const d = declOf(cur)
    if (d) return d
    cur = cur.parent
  }
  return null
}

export function analyzeSymbols(root: string): SymbolGraphResult {
  const t0 = Date.now()
  const cfgs = tsconfigsOf(root)
  if (!cfgs.length) {
    throw new Error('这个项目里没有 tsconfig —— 符号级视图暂时只支持有 tsconfig 的 TS/JS 项目')
  }

  const isLocal = (f: string): boolean => f.startsWith(root) && !f.includes('node_modules')
  const rel = (f: string): string => path.relative(root, f).split(path.sep).join('/')

  const symbols = new Map<string, SymbolNode>()
  const edges = new Map<string, SymbolEdge[]>()
  const checkedJsOf = new Map<string, boolean>()
  /** 被 `import()` 动态引入过的文件。全扫完之后统一给它们的导出加引用（见下） */
  const dynImported = new Set<string>()

  for (const cfgName of cfgs) {
    const cfg = ts.readConfigFile(path.join(root, cfgName), ts.sys.readFile)
    if (cfg.error) continue
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root)
    if (!parsed.fileNames.length) continue
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
    const checker = program.getTypeChecker()
    const checkedJs = parsed.options.checkJs === true

    for (const sf of program.getSourceFiles()) {
      if (!isLocal(sf.fileName) || sf.isDeclarationFile) continue
      const file = rel(sf.fileName)
      // 同一个文件可能被两份 tsconfig 都包含；**取「有任何一份检查了它」** ——
      // 宁可把它当可信，也不要因为另一份没检查就整片标灰
      checkedJsOf.set(file, (checkedJsOf.get(file) ?? false) || checkedJs)

      const visit = (n: ts.Node): void => {
        // ① 声明
        const d = declOf(n)
        if (d) {
          const id = `${file}#${d.name}`
          if (!symbols.has(id)) {
            symbols.set(id, {
              id,
              file,
              name: d.name,
              kind: d.kind,
              line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              exported: isExported(n),
              topLevel: isTopLevel(n),
              refs: 0
            })
          }
        }

        // ② 引用。**坑 2：数的是标识符引用，不是调用点。**
        //    `setInterval(fn, …)` / `onClick={fn}` / `export { fn }` 都是真实使用，
        //    只数 CallExpression 会把它们全判成死代码（实测 reapIdleSessions 中招）。
        if (ts.isIdentifier(n) && !isImportBinding(n)) {
          const sym = realSymbol(checker, checker.getSymbolAtLocation(n)) // ← 坑 1 在这
          const decl = sym?.declarations?.[0]
          if (decl && isLocal(decl.getSourceFile().fileName)) {
            const target = `${rel(decl.getSourceFile().fileName)}#${sym!.getName()}`
            // 定义处自身那次出现不算引用
            const atOwnDecl =
              (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isVariableDeclaration(decl)) &&
              (decl as { name?: ts.Node }).name === n
            if (!atOwnDecl) {
              const s = symbols.get(target)
              if (s) s.refs += 1
              else
                symbols.set(target, {
                  id: target,
                  file: rel(decl.getSourceFile().fileName),
                  name: sym!.getName(),
                  kind: 'other',
                  line: 1,
                  exported: false,
                  // 这条是「被引用时才发现」的符号（跨 Program 边界的情形），
                  // **不当顶层** —— 没见过它的声明现场，判死代码不可靠
                  topLevel: false,
                  refs: 1
                })
              // ③ 文件内调用边：调用方与被调方在同一个文件里才算
              //    （跨文件的归第二期的邻域视图，画在文件内结构图上只会糊）
              const from = enclosingDecl(n)
              const targetFile = rel(decl.getSourceFile().fileName)
              if (from && targetFile === file && from.name !== sym!.getName()) {
                const list = edges.get(file) ?? []
                const key = `${file}#${from.name}`
                if (!list.some((e) => e.from === key && e.to === target)) {
                  list.push({ from: key, to: target })
                  edges.set(file, list)
                }
              }
            }
          }
        }
        // ④ **动态 import 的模块，它的导出一律算被引用。**
        //
        //    `lazy(() => import('./DictView'))` 和
        //    `const { f } = await import('./x')` 这两种，靠标识符遍历都连不上 ——
        //    前者根本没有那个标识符，后者的解构绑定 checker 不往回连。
        //    实测本仓库 11 条「没人用」里 3 条是这么来的（DictView / WikiView / transcribeFile）。
        //
        //    **这里刻意做粗**：不去分辨用了哪几个导出，整个模块的导出全 +1。
        //    宁可漏报几个真死代码，也不要报假的 —— 一份会误伤的清单，
        //    用户很快就不看了，然后连真的那几条也跟着漏掉。
        if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const spec = n.arguments[0]
          if (spec && ts.isStringLiteral(spec)) {
            const mod = checker.getSymbolAtLocation(spec)
            const target = mod ?? (() => {
              // 字符串字面量上拿不到符号时，走 resolvedModules 那条
              const resolved = ts.resolveModuleName(spec.text, sf.fileName, parsed.options, ts.sys)
              const f = resolved.resolvedModule?.resolvedFileName
              const other = f ? program.getSourceFile(f) : undefined
              return other ? checker.getSymbolAtLocation(other) : undefined
            })()
            // **只记文件，不当场加引用。**
            // 当场加的话依赖遍历顺序：目标文件还没被扫到时 `symbols` 里没有它，
            // 引用就静默丢了 —— 而这种错只在某些项目上出现，最难查。
            if (target) {
              for (const ex of checker.getExportsOfModule(target)) {
                const d2 = ex.declarations?.[0]
                if (d2 && isLocal(d2.getSourceFile().fileName)) {
                  dynImported.add(rel(d2.getSourceFile().fileName))
                }
              }
            }
          }
        }

        ts.forEachChild(n, visit)
      }
      visit(sf)
    }
  }

  // ── 动态 import 的补偿（**必须在全扫完之后**，见上面 ④ 的注释）────────────
  for (const s2 of symbols.values()) {
    if (s2.exported && dynImported.has(s2.file)) s2.refs += 1
  }

  // ── 组装 ──────────────────────────────────────────────────────────────────
  const byFile = new Map<string, SymbolNode[]>()
  for (const s of symbols.values()) {
    byFile.set(s.file, [...(byFile.get(s.file) ?? []), s])
  }
  const files: FileStructure[] = [...byFile.entries()]
    .map(([file, syms]) => ({
      file,
      symbols: syms.sort((a, b) => a.line - b.line),
      edges: edges.get(file) ?? [],
      trustworthy: isTrustworthy(file, checkedJsOf.get(file) ?? false)
    }))
    .sort((a, b) => b.symbols.length - a.symbols.length)

  const dead: { sym: SymbolNode; verdict: 'dead' | 'unsure' }[] = []
  for (const s of symbols.values()) {
    const v = deadCodeVerdict(s, checkedJsOf.get(s.file) ?? false)
    if (v === 'dead' || v === 'unsure') dead.push({ sym: s, verdict: v })
  }
  // 真死的排前面；同档内按文件、行号
  dead.sort(
    (a, b) =>
      (a.verdict === b.verdict ? 0 : a.verdict === 'dead' ? -1 : 1) ||
      a.sym.file.localeCompare(b.sym.file) ||
      a.sym.line - b.sym.line
  )

  return {
    root,
    files,
    dead,
    stats: {
      files: files.length,
      symbols: symbols.size,
      refs: [...symbols.values()].reduce((n, s) => n + s.refs, 0)
    },
    ms: Date.now() - t0,
    untrusted: files.filter((f) => !f.trustworthy).length
  }
}
