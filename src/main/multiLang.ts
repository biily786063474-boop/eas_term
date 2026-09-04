// Python / C·C++ / Swift 的依赖解析。**零 electron**，`node --test` 直接跑。
//
// JS/TS 那条走 dependency-cruiser（见 `codeGraphAnalyze.ts`）；这里是另外三种栈。
// 提取 import 的那一层在 `shared/langImports.ts`（纯字符串，有测试），
// 这个文件只做**路径解析** —— 也就是「那个说明符到底落到哪个文件上」，
// 整条链里最容易错、错了又最看不出来的一段。
//
// ── 一条贯穿三种语言的纪律：解析不到就丢掉，不造节点 ────────────────────────
// `import numpy` / `#include <stdio.h>` / `import Foundation` 都解析不到本地文件。
// **丢掉，不要凭说明符造一个节点** —— 那正是 JS 那侧犯过的错
//（`fs`、`util`、`@scope/pkg` 混进图里，本仓库 16 个假节点）。
// 判据统一：**磁盘上真有这个文件**才算数。

import fs from 'node:fs'
import path from 'node:path'
import { extractCInclude, extractPythonImport, extractSwiftImport } from '../shared/langImports.ts'
import { gitignoreDirMatcher } from '../shared/gitignore.ts'

export type Stack = 'python' | 'c' | 'swift'

const EXT: Record<Stack, string[]> = {
  python: ['.py'],
  c: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hh', '.hxx', '.m', '.mm'],
  swift: ['.swift']
}

/** 明显不是源码的目录，走到就不进去。和 `codeGraphAnalyze.ts` 那份同源，
 *  多了几个这几种栈特有的（`.build`、`venv`、`Pods`）。 */
const SKIP = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '.git', '.build', '.venv', 'venv', 'env', '__pycache__', 'Pods', 'Carthage',
  'DerivedData', 'docs', 'doc', 'memory', 'assets', 'public', 'static'
])

/** 项目自己的 `.gitignore`。**它才是「什么不是源码」的权威声明** ——
 *  硬编名单永远列不全：实测「美颜」的 696 个第三方文件在 `third_party/`、
 *  「口播相机」的产物在 `build-dev/`，两个都不在通用名单里，
 *  但两个项目的 .gitignore 里都写着。 */
function ignoredDir(root: string): (relDir: string) => boolean {
  let text = ''
  try {
    text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  } catch {
    /* 没有就只靠 SKIP */
  }
  return gitignoreDirMatcher(text)
}

/** 递归列出某几种扩展名的文件（相对 root 的路径，`/` 分隔）。 */
function listFiles(root: string, exts: readonly string[], max = 20000): string[] {
  const out: string[] = []
  const ignored = ignoredDir(root)
  const walk = (dir: string): void => {
    if (out.length >= max) return
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (ignored(rel)) continue
        walk(abs)
      } else if (exts.includes(path.extname(e.name).toLowerCase())) {
        out.push(rel)
      }
    }
  }
  walk(root)
  return out
}

/** 这个项目里有哪几种栈。**按源码文件数认**，不看 package.json 之类的元数据 ——
 *  元数据会撒谎（一个 Swift 项目里也可能有个 package.json 装工具）。 */
export function detectStacks(root: string): Stack[] {
  const out: Stack[] = []
  for (const s of ['python', 'c', 'swift'] as const) {
    if (listFiles(root, EXT[s], 1).length > 0) out.push(s)
  }
  return out
}

export interface LangGraph {
  nodes: { id: string; weight: number; lang: Stack }[]
  edges: { from: string; to: string }[]
  /** 这种栈画出来的是什么粒度。Swift 只有模块级 —— 界面上要说清楚 */
  granularity: Record<string, 'file' | 'module'>
}

export function analyzeLangs(root: string, stacks: readonly Stack[]): LangGraph {
  const nodes = new Map<string, { id: string; weight: number; lang: Stack }>()
  const edges: { from: string; to: string }[] = []
  const granularity: Record<string, 'file' | 'module'> = {}
  const seen = new Set<string>()
  const add = (from: string, to: string): void => {
    const k = from + ' ' + to
    if (from === to || seen.has(k)) return
    seen.add(k)
    edges.push({ from, to })
  }

  if (stacks.includes('python')) {
    granularity.python = 'file'
    resolvePython(root, nodes, add)
  }
  if (stacks.includes('c')) {
    granularity.c = 'file'
    resolveC(root, nodes, add)
  }
  if (stacks.includes('swift')) {
    granularity.swift = 'module'
    resolveSwift(root, nodes, add)
  }
  return { nodes: [...nodes.values()], edges, granularity }
}

type NodeMap = Map<string, { id: string; weight: number; lang: Stack }>

const read = (root: string, rel: string): string => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8')
  } catch {
    return ''
  }
}

const dirOf = (rel: string): string => {
  const d = path.posix.dirname(rel)
  return d === '.' ? '' : d
}

// ── Python ──────────────────────────────────────────────────────────────────

function resolvePython(root: string, nodes: NodeMap, add: (a: string, b: string) => void): void {
  const files = listFiles(root, EXT.python)
  const have = new Set(files)
  for (const f of files) nodes.set(f, { id: f, weight: 1, lang: 'python' })

  /** 点号模块名 → 文件。先试 `a/b.py`，再试 `a/b/__init__.py`。 */
  const toFile = (dotted: string, baseDir: string): string | null => {
    const rel = dotted.split('.').filter(Boolean).join('/')
    if (!rel) return null
    const stem = path.posix.normalize(baseDir ? baseDir + '/' + rel : rel)
    for (const cand of [stem + '.py', stem + '/__init__.py']) {
      if (have.has(cand)) return cand
    }
    return null
  }

  for (const f of files) {
    const dir = dirOf(f)
    for (const imp of extractPythonImport(read(root, f))) {
      // 相对 import：level 1 = 当前目录，2 = 上一层……
      let base = dir
      for (let i = 1; i < imp.level; i++) base = dirOf(base)
      // 绝对 import 从项目根算起（顺带也试一次「和引用方同目录」——
      // 单目录脚本项目里 `import util` 指的就是隔壁那个 util.py）
      const bases = imp.level > 0 ? [base] : ['', dir]
      for (const b of bases) {
        const hit = toFile(imp.module, b)
        if (hit) {
          add(f, hit)
          break
        }
      }
      // `from pkg import mod` 里的 mod 可能是子模块，也试一遍
      for (const n of imp.names ?? []) {
        for (const b of bases) {
          const sub = toFile(imp.module ? imp.module + '.' + n : n, b)
          if (sub) {
            add(f, sub)
            break
          }
        }
      }
    }
  }
}

// ── C / C++ ─────────────────────────────────────────────────────────────────

function resolveC(root: string, nodes: NodeMap, add: (a: string, b: string) => void): void {
  const files = listFiles(root, EXT.c)
  const have = new Set(files)
  for (const f of files) nodes.set(f, { id: f, weight: 1, lang: 'c' })

  /** 常见的 include 根。相对路径找不到时挨个试。 */
  const roots = ['', 'include', 'src', 'inc', 'headers']

  for (const f of files) {
    const dir = dirOf(f)
    for (const inc of extractCInclude(read(root, f))) {
      // ① 先按 C 的规矩：相对包含方所在目录
      const local = path.posix.normalize(dir ? dir + '/' + inc.path : inc.path)
      if (have.has(local)) {
        add(f, local)
        continue
      }
      // ② 再试 include 根。**尖括号也走这一步** ——
      //    `#include <mylib.h>` 在项目里真有这个文件时它就是本地的，
      //    尖括号只是搜索顺序不同，不代表「一定是系统头」。
      let hit: string | null = null
      for (const r of roots) {
        const cand = path.posix.normalize(r ? r + '/' + inc.path : inc.path)
        if (have.has(cand)) {
          hit = cand
          break
        }
      }
      // ③ 还找不到：**丢掉**。stdio.h / vector 这类没有本地文件，
      //    造节点的话图上会被系统头淹掉。
      if (hit) add(f, hit)
    }
  }
}

// ── Swift ───────────────────────────────────────────────────────────────────

/** 苹果自带框架里**容易和目录名撞车**的那些。
 *
 *  实测用户的「口播相机」：项目里有个 `Speech/` 目录，而 `import Speech` 是
 *  苹果的语音框架 —— 不挡的话图上会多出一条根本不存在的依赖。
 *  这份名单挡的是「撞名」；挡不住的（冷门框架撞了冷门目录名）代价是多一条边，
 *  所以 **Package.swift 里显式声明的 target 优先** —— 那份是权威，不用猜。 */
const APPLE_FRAMEWORKS = new Set([
  'Foundation', 'UIKit', 'AppKit', 'SwiftUI', 'Combine', 'CoreData', 'CoreGraphics',
  'CoreImage', 'CoreLocation', 'CoreML', 'CoreMedia', 'CoreAudio', 'CoreText',
  'AVFoundation', 'AVKit', 'Speech', 'Vision', 'Metal', 'MetalKit', 'SceneKit',
  'SpriteKit', 'ARKit', 'RealityKit', 'MapKit', 'WebKit', 'Network', 'CryptoKit',
  'Security', 'os', 'Dispatch', 'XCTest', 'Testing', 'Accelerate', 'Charts',
  'WidgetKit', 'UserNotifications', 'StoreKit', 'HealthKit', 'HomeKit', 'GameKit',
  'PhotosUI', 'Photos', 'Contacts', 'EventKit', 'MessageUI', 'QuartzCore',
  'ServiceManagement', 'SystemConfiguration', 'IOKit', 'Carbon', 'Cocoa'
])

function resolveSwift(root: string, nodes: NodeMap, add: (a: string, b: string) => void): void {
  const files = listFiles(root, EXT.swift)
  if (!files.length) return

  // ── target 的识别 ────────────────────────────────────────────────────────
  // Package.swift 里显式写了就用它（权威）；否则按目录推：
  // `Sources/<X>/…` 里的 X，再否则是顶层目录名。
  const declared = new Set<string>()
  try {
    const pkg = fs.readFileSync(path.join(root, 'Package.swift'), 'utf8')
    for (const m of pkg.matchAll(/\.\w*[Tt]arget\s*\(\s*name:\s*"([^"]+)"/g)) declared.add(m[1])
  } catch {
    /* 没有 Package.swift 就靠目录 */
  }

  /** 一个文件属于哪个 target。返回的是**目录路径**（当节点 id 用）。 */
  const targetOf = (rel: string): string => {
    const parts = rel.split('/')
    if (parts[0] === 'Sources' && parts.length > 2) return 'Sources/' + parts[1]
    return parts.length > 1 ? parts[0] : '根目录'
  }
  /** target 目录路径 → 它的模块名（import 时写的那个）。 */
  const moduleName = (t: string): string => t.split('/').pop() ?? t

  const byTarget = new Map<string, string[]>()
  for (const f of files) {
    const t = targetOf(f)
    byTarget.set(t, [...(byTarget.get(t) ?? []), f])
  }

  // 本地模块名 → target 路径。**声明过的优先**，其次是目录推出来的。
  const local = new Map<string, string>()
  for (const t of byTarget.keys()) {
    const n = moduleName(t)
    if (declared.size > 0 && !declared.has(n)) continue // 有权威名单时只认名单里的
    if (declared.size === 0 && APPLE_FRAMEWORKS.has(n)) continue // 没名单时挡撞名
    local.set(n, t)
  }

  for (const [t, list] of byTarget) {
    nodes.set(t, { id: t, weight: list.length, lang: 'swift' })
  }
  for (const [t, list] of byTarget) {
    for (const f of list) {
      for (const mod of extractSwiftImport(read(root, f))) {
        const hit = local.get(mod)
        if (hit !== undefined && hit !== t) add(t, hit)
      }
    }
  }
}
