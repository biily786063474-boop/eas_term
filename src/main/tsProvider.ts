// TS/TSX 的**邻域 provider**：谁调用了这个 / 这个调用了谁。
//
// **零 electron**，`node --test` 直接跑。
//
// ── 它是 `shared/symbolProvider.ts` 那个契约的「内置实现」 ────────────────────
// 契约是按 LSP 的形状定的（`SymbolRef` 用 0-based 行列，就是 LSP
// `prepareCallHierarchy` 要的那种）。TS 这条不走 LSP —— 直接用已经在依赖里的
// `typescript` 包更快更准（实测调用点解析 96.6%，且不用起进程）。
// 但**它的入参出参和 LSP provider 一模一样**，所以界面那侧不需要知道谁在答。
//
// ── 缓存：Program 必须复用 ──────────────────────────────────────────────────
// 冷启动建 Program 要 2~4 秒（本仓库 497 个文件）。邻域查询是**交互式**的
// （点一个符号看一次），每次重建就没法用了。所以按项目根缓存，
// 由界面上的「重新解析」显式失效（`dropTsCache`）。

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import type { SymbolNode } from '../shared/symbolGraph.ts'
import { declOf, isImportBinding, isTopLevel, posOf, realSymbol, tsconfigsOf } from './tsAst.ts'
import {
  rankAndTrim,
  type CallSite,
  type Neighborhood,
  type SymbolRef
} from '../shared/symbolProvider.ts'

/** 这个 provider 认哪些扩展名。 */
export const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

interface Cached {
  programs: { program: ts.Program; checker: ts.TypeChecker }[]
  at: number
}
const cache = new Map<string, Cached>()

/** 丢掉某个项目的 Program 缓存（界面上点「重新解析」时调）。 */
export function dropTsCache(root: string): void {
  cache.delete(root)
}

function programsOf(root: string): Cached {
  const hit = cache.get(root)
  if (hit) return hit
  const programs: Cached['programs'] = []
  for (const cfgName of tsconfigsOf(root, (n) => fs.existsSync(path.join(root, n)))) {
    const cfg = ts.readConfigFile(path.join(root, cfgName), ts.sys.readFile)
    if (cfg.error) continue
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root)
    if (!parsed.fileNames.length) continue
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
    programs.push({ program, checker: program.getTypeChecker() })
  }
  const made = { programs, at: Date.now() }
  cache.set(root, made)
  return made
}

/** 往上找这个位置属于哪个声明（调用方是谁）。 */
function enclosing(n: ts.Node, sf: ts.SourceFile, file: string): SymbolNode | null {
  let cur: ts.Node | undefined = n.parent
  while (cur && !ts.isSourceFile(cur)) {
    const d = declOf(cur)
    if (d) {
      return {
        id: `${file}#${d.name}`,
        file,
        name: d.name,
        kind: d.kind,
        ...posOf(sf, cur),
        exported: false,
        refs: 0,
        topLevel: isTopLevel(cur)
      }
    }
    cur = cur.parent
  }
  return null
}

/** 调用点不在任何**具名**声明里时，给它一个有意义的标注。
 *
 *  **不能一律叫「（模块顶层）」** —— 测试文件里 `it('…', () => { … })` 的回调
 *  全都不具名，一律标模块顶层的话，一个文件里几十次调用会糊成一条边，
 *  而「谁调用了这个」正是要看清有哪些调用方（2026-09-03 真仓库实测：
 *  `readMcpServers` 的调用方显示成「launch.test.ts:（模块顶层）×8」，
 *  完全看不出那是 8 条不同的测试）。
 *
 *  往上找最近的**具名上下文**：`it('名字', …)` / `describe('名字', …)` 这类
 *  把字符串当第一个参数的调用，用那个字符串；再找不到才退回「文件顶层」。 */
function anonymousCaller(
  n: ts.Node,
  sf: ts.SourceFile,
  file: string,
  line: number
): SymbolNode | null {
  let cur: ts.Node | undefined = n.parent
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isCallExpression(cur)) {
      const first = cur.arguments[0]
      if (first && ts.isStringLiteral(first)) {
        const label = `${ts.isIdentifier(cur.expression) ? cur.expression.text : '?'}("${first.text}")`
        return {
          id: `${file}#${label}`,
          file,
          name: label,
          kind: 'other',
          ...posOf(sf, cur),
          exported: false,
          refs: 0,
          topLevel: false
        }
      }
    }
    cur = cur.parent
  }
  return {
    id: `${file}#（文件顶层）`,
    file,
    name: '（文件顶层）',
    kind: 'other',
    line,
    character: 0,
    exported: false,
    refs: 0,
    topLevel: true
  }
}

/** 把若干调用点按「调用方符号」归并成边。 */
function group(hits: { sym: SymbolNode; line: number }[]): CallSite[] {
  const by = new Map<string, CallSite>()
  for (const h of hits) {
    const cur = by.get(h.sym.id)
    if (cur) {
      if (!cur.lines.includes(h.line)) cur.lines.push(h.line)
    } else {
      by.set(h.sym.id, { symbol: h.sym, lines: [h.line] })
    }
  }
  for (const s of by.values()) s.lines.sort((a, b) => a - b)
  return [...by.values()]
}

/**
 * 一个符号的邻域。
 *
 * @param ref **行列是 0-based**（LSP 约定），且 `character` 要落在**符号名**上 ——
 *            落在 `function` 关键字上拿不到符号。转换只许在 `refOf` 那一处发生。
 * @returns 找不到那个符号时返回 `null`（不抛）—— 文件可能刚被删/改过
 */
export function tsNeighborhood(root: string, ref: SymbolRef): Neighborhood | null {
  const { programs } = programsOf(root)
  const abs = path.join(root, ref.file)
  const rel = (f: string): string => path.relative(root, f).split(path.sep).join('/')
  const isLocal = (f: string): boolean => f.startsWith(root) && !f.includes('node_modules')

  // ── 定位中心符号 ─────────────────────────────────────────────────────────
  let center: SymbolNode | null = null
  let centerSym: ts.Symbol | undefined
  for (const { program, checker } of programs) {
    const sf = program.getSourceFile(abs)
    if (!sf) continue
    const pos = sf.getPositionOfLineAndCharacter(ref.line, ref.character)
    // 从该位置往里找那个标识符
    const find = (n: ts.Node): ts.Node | undefined => {
      if (n.getStart(sf) <= pos && pos < n.getEnd()) {
        return ts.forEachChild(n, find) ?? n
      }
      return undefined
    }
    const node = find(sf)
    if (!node || !ts.isIdentifier(node)) continue
    const sym = realSymbol(checker, checker.getSymbolAtLocation(node))
    const d = sym?.declarations?.[0]
    if (!d) continue
    const dsf = d.getSourceFile()
    const dd = declOf(d) ?? declOf(d.parent)
    center = {
      id: `${rel(dsf.fileName)}#${sym!.getName()}`,
      file: rel(dsf.fileName),
      name: sym!.getName(),
      kind: dd?.kind ?? 'other',
      ...posOf(dsf, d),
      exported: true,
      refs: 0,
      topLevel: isTopLevel(d)
    }
    centerSym = sym
    break
  }
  if (!center || !centerSym) return null

  // ── 扫全仓找 incoming / outgoing ────────────────────────────────────────
  const inHits: { sym: SymbolNode; line: number }[] = []
  const outHits: { sym: SymbolNode; line: number }[] = []
  const centerDecl = centerSym.declarations?.[0]

  for (const { program, checker } of programs) {
    for (const sf of program.getSourceFiles()) {
      if (!isLocal(sf.fileName) || sf.isDeclarationFile) continue
      const file = rel(sf.fileName)
      const inCenterFile = file === center.file

      const visit = (n: ts.Node): void => {
        // **import 绑定不算一次调用**（同 tsSymbols 的坑 2）——
        // 不挡的话邻域里会多出一个「（模块顶层）」，那其实是 import 语句
        if (ts.isIdentifier(n) && !isImportBinding(n)) {
          const sym = realSymbol(checker, checker.getSymbolAtLocation(n))
          const d = sym?.declarations?.[0]
          if (d && sym) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
            // ① incoming：这个标识符指向中心符号，且不是它自己的声明处
            if (d === centerDecl && n.parent !== centerDecl) {
              const from = enclosing(n, sf, file) ?? anonymousCaller(n, sf, file, line)
              if (from) inHits.push({ sym: from, line })
            }
            // ② outgoing：这个标识符在中心符号的**函数体内**，指向本仓库的别的**函数**
            //
            //    ⚠️ **只认 `declOf(d)` 本身，不能拿 `declOf(d.parent)` 兜底。**
            //    形参的 parent 正好是那个函数声明 —— 兜底的话
            //    `go(cfg, deny)` 会报成「go 调用了 cfg 和 deny」（2026-09-03 真仓库实测撞到：
            //    readMcpServers 的 outgoing 是 configPath / denyServers 两个形参）。
            //    局部变量、类型引用同理。
            //
            //    `d !== centerDecl` 这条**不能加**：递归是真的自己调自己，要留着。
            if (inCenterFile && isLocal(d.getSourceFile().fileName)) {
              const owner = enclosing(n, sf, file)
              if (owner && owner.name === center!.name) {
                const dsf = d.getSourceFile()
                const dd = declOf(d)
                // 指向自己的**声明处那次出现**不算（那是 `function rec(` 里的名字，
                // 不是一次调用）；函数体里的 `rec(...)` 才算
                // **用节点身份比，不用位置比。** 位置比较看着等价，但 `getStart`
                // 会跳过前导 trivia，同一个位置在不同调用下可能差几个字符 ——
                // 于是「声明处那次出现」时而被认出、时而漏掉，
                // 表现是 outgoing 里偶尔多出自己（2026-09-03 真仓库：territoryOf 调用了 territoryOf）。
                const atOwnName = n === (d as { name?: ts.Node }).name
                if (dd && !atOwnName) {
                  outHits.push({
                    sym: {
                      id: `${rel(dsf.fileName)}#${sym.getName()}`,
                      file: rel(dsf.fileName),
                      name: sym.getName(),
                      kind: dd.kind,
                      ...posOf(dsf, d),
                      exported: false,
                      refs: 0,
                      topLevel: isTopLevel(d)
                    },
                    line
                  })
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

  const inc = rankAndTrim(group(inHits))
  const out = rankAndTrim(group(outHits))
  return {
    center,
    incoming: inc.sites,
    outgoing: out.sites,
    truncated: inc.truncated || out.truncated,
    provider: 'TypeScript'
  }
}
