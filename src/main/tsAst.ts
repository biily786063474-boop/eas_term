// TS AST 上那几个**共用的小判断**。`tsSymbols.ts`（第一期）和 `tsProvider.ts`
// （第二期邻域）都要用。
//
// ⚠️ **只许有这一份。** 这三个判断各自都有事故史，两份拷贝的下场必然是
// 其中一份没跟上，而症状只是「有的视图数字不一样」，很难联想到这里：
//   · `realSymbol` 不解 alias → 跨文件调用全变自环（死代码假阳性 644→24）
//   · `isImportBinding` 漏挡 → import 语句被算成一次调用（邻域里多出「（模块顶层）」）
//   · `declOf` 认得少 → 箭头函数形式的符号整类消失

import ts from 'typescript'

/** 符号种类。和 `shared/symbolGraph.ts` 的 `SymbolNode['kind']` 同一套。 */
export type DeclKind = 'function' | 'method' | 'class' | 'arrow' | 'other'

/** **必须解别名。**
 *
 *  `import { foo } from './a'` 之后在本文件里调 `foo()`，
 *  `getSymbolAtLocation` 返回的符号，它的 `declarations[0]` 是**本文件里那条
 *  import 语句**，不是 `a.ts` 里的函数本体。 */
export function realSymbol(checker: ts.TypeChecker, sym: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!sym) return undefined
  return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
}

/** 这个标识符是不是 **import 语句里的绑定名**（而不是一次真正的使用）。
 *
 *  `import { foo } from './a'` 里的那个 `foo` 不算「用了 foo」——
 *  只 import 却没用到的符号仍然是死的。
 *
 *  ⚠️ **`export { foo } from './a'` 要算。** 再导出是把它放进了公开 API。
 *  所以这里只挡 Import*，不挡 ExportSpecifier。 */
export function isImportBinding(n: ts.Identifier): boolean {
  const p = n.parent
  return ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)
}

/** 这个节点是不是一个「函数/类声明」，是的话返回名字与种类。 */
export function declOf(n: ts.Node): { name: string; kind: DeclKind } | null {
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

/** 这个声明是不是在**模块顶层**（而不是嵌在函数/对象字面量里）。
 *  只有顶层的能进死代码清单 —— 对象字面量方法是接口成员的实现，
 *  调用方引的是接口那侧的声明，键对不上会让每个实现都被判死。 */
export function isTopLevel(n: ts.Node): boolean {
  let cur: ts.Node | undefined = n.parent
  while (cur && (ts.isVariableDeclarationList(cur) || ts.isVariableStatement(cur))) cur = cur.parent
  return !!cur && ts.isSourceFile(cur)
}

/** 这个项目里有哪几份 tsconfig 要各建一个 Program。
 *
 *  **不能合成一个**：`tsconfig.node.json`（主进程）与 `tsconfig.web.json`
 *  （渲染层）的编译选项和文件集都不同，合起来两边都错。 */
export function tsconfigsOf(root: string, exists: (p: string) => boolean): string[] {
  const named = ['tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.app.json', 'tsconfig.json']
  const hit = named.filter((n) => exists(n))
  // node/web 那两份存在时就不要再带上根 tsconfig —— 它多半只是个 references 壳子，
  // 建出来的 Program 是空的，白花几百毫秒
  const split = hit.filter((n) => n !== 'tsconfig.json')
  return split.length ? split : hit
}

/** 一个声明的「行（1-based）＋ **名字**的列（0-based）」。
 *
 *  ⚠️ **列要指向名字，不是声明的起点。** LSP 的 `prepareCallHierarchy`
 *  要求位置落在名字上；落在 `function` 关键字或缩进空白上会拿不到符号。
 *  没有名字节点时退回声明起点（总比 0 强）。 */
export function posOf(sf: ts.SourceFile, n: ts.Node): { line: number; character: number } {
  const named = (n as { name?: ts.Node }).name
  const at = named ?? n
  const lc = sf.getLineAndCharacterOfPosition(at.getStart(sf))
  // 行按声明起点算（人读的是「这个函数在第几行」），列按名字算（机器要定位）
  const declLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line
  return { line: declLine + 1, character: lc.character }
}
