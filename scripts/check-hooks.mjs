#!/usr/bin/env node
// 组件里的 hook 不许出现在条件 return 之后。
//
// 2026-08-20 踩的：在 `if (sessionId) { … return }` 之后写了 `useState`/`useEffect`，
// 于是空态跑 N 个 hook、聊天态只跑 N-2 个。React 靠**调用顺序**认 hook，数量一变就是
// `Minified React error #300`（Should have a queue），整个界面被 ErrorBoundary 兜住。
// 触发点是「发送第一条消息」—— sessionId 从 null 变有值的那一帧，最日常的操作。
//
// **tsc 抓不到**（类型全对），项目也没有 eslint（react-hooks/rules-of-hooks 本来干这个）。
//
// **必须用 AST，不能用正则。** 第一版拿缩进 + `^\s{2}return` 做启发式，报出 343 处 ——
// 全是把模块里其它辅助函数的 return 当成了组件的 early return。一个会误报几百次的检查
// 等于没有：下一个人只会学会忽略它。这里按真实作用域判：只看**同一个函数体内**、
// 且不下钻进嵌套函数与回调。
//
//   node scripts/check-hooks.mjs

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.join(process.cwd(), 'src', 'renderer', 'src')
const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx')) files.push(p)
  }
})(ROOT)

const isHookName = (n) => /^use[A-Z]/.test(n)
const isFnLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)

const bad = []

for (const file of files) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  /** 在一个函数体内收集：hook 调用点 + return 语句点。**不下钻进嵌套函数** ——
   *  回调里的 return 是那个回调的，跟外层组件的 hook 顺序无关（第一版就是栽在这儿）。 */
  function scan(body) {
    const hooks = []
    const returns = []
    ;(function visit(n) {
      if (n !== body && isFnLike(n)) return // 嵌套函数：它自己会被单独检查
      if (ts.isCallExpression(n)) {
        const e = n.expression
        const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ''
        if (isHookName(name)) hooks.push({ pos: n.getStart(sf), name })
      }
      if (ts.isReturnStatement(n)) returns.push({ pos: n.getStart(sf) })
      ts.forEachChild(n, visit)
    })(body)
    return { hooks, returns }
  }

  ;(function walkFns(n) {
    if (isFnLike(n) && n.body && ts.isBlock(n.body)) {
      const { hooks, returns } = scan(n.body)
      if (hooks.length && returns.length) {
        const firstReturn = Math.min(...returns.map((r) => r.pos))
        for (const h of hooks) {
          if (h.pos > firstReturn) {
            const line = sf.getLineAndCharacterOfPosition(h.pos).line + 1
            const rline = sf.getLineAndCharacterOfPosition(firstReturn).line + 1
            bad.push([file, line, rline, h.name])
          }
        }
      }
    }
    ts.forEachChild(n, walkFns)
  })(sf)
}

if (!bad.length) {
  console.log('✅ 没有 hook 出现在条件 return 之后')
  process.exit(0)
}
console.error(`❌ ${bad.length} 处 hook 写在了条件 return 之后（React 会报 error #300）：\n`)
for (const [f, line, rline, name] of bad)
  console.error(`  ${path.relative(process.cwd(), f)}:${line}  ${name}()  —— 同一函数体内第 ${rline} 行已经 return 过`)
process.exit(1)
