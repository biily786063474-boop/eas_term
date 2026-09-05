// 「这个 resumeId 是哪个 harness 签发的」—— 查磁盘，不猜。
//
// **零 electron，`node --test` 直接跑。**
//
// ── 为什么要有这一层 ──────────────────────────────────────────────────────
// 一个 resumeId 只属于签发它的那个 harness，对别的 harness 毫无意义。
// 2026-09-04 的事故：一段 Claude Code 的对话（40 轮），重挂载时被 `pickDefaultCli`
// 的推测链（`lastUsed` = 用户在别处刚用过的 omp）挑成了 omp，于是 Claude 的 id 被递给
// omp 做 `session/resume` → "ACP session not found" → 那条对话永久报废。
// 更糟的是 `setAgentCli` 把这个**猜出来的** omp 钉进了 `pane.cli`，错误成了永久的。
//
// 根子是「归属靠猜」。而签发者其实是**可以查证的** —— 三个 harness 都把会话落在
// 磁盘上固定的位置，按 id 找一下就知道是谁的：
//
//   claude  ~/.claude/projects/<编码后的 cwd>/<id>.jsonl
//   codex   ~/.codex/sessions/<年>/<月>/<日>/rollout-<时间>-<id>.jsonl
//   omp     <userData>/omp/agent/sessions/**/…<id>…
//
// 往后 `pane.resumeCli` 会和 `resumeId` 一起存（谁报回的 id 就记谁），这里主要给
// **老数据**用：2026-09-03 之前建的对话只有 resumeId 没有签发者，第一次重挂载时
// 靠这个补上。也是主进程 `start` 的最后一道闸：签发者 ≠ 要起的 cli 就不递 id。

import fs from 'node:fs'
import path from 'node:path'
// ⚠️ 相对 import **必须带 .ts** —— `node --test` 走类型剥离，无扩展名解析不到
// （ERR_MODULE_NOT_FOUND），而 tsx 单跑时能过，于是只在全量跑时红。仓库硬规矩。
import { candidateDirs } from '../sessionPaths.ts'

export type ResumeOwner = 'claude' | 'codex' | 'omp'

export interface OwnerLookupPaths {
  /** `os.homedir()` 或 `app.getPath('home')` —— 调用方定，别在这里读环境变量 */
  home: string
  /** Electron userData；omp 的会话在它下面 */
  userData: string
  /** 项目改过名时的旧路径（Claude 的目录名跟 cwd 走，见 sessionPaths.ts） */
  pastPaths?: string[]
}

/** id 必须长得像 id：这些值会拼进路径，别让 `../` 之类的东西进来 */
const SAFE_ID = /^[\w-]{8,}$/

function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Claude：按 cwd 编码出候选目录（含旧路径），逐个找 `<id>.jsonl` */
function isClaude(id: string, cwd: string, o: OwnerLookupPaths): boolean {
  const root = path.join(o.home, '.claude', 'projects')
  for (const d of candidateDirs(root, cwd, o.pastPaths)) {
    if (existsFile(path.join(d, `${id}.jsonl`))) return true
  }
  return false
}

/** Codex：文件名结尾是 `-<id>.jsonl`，目录是固定三层的日期，不做无界递归 */
function isCodex(id: string, o: OwnerLookupPaths): boolean {
  const root = path.join(o.home, '.codex', 'sessions')
  const suffix = `-${id}.jsonl`
  try {
    for (const y of fs.readdirSync(root)) {
      for (const m of safeList(path.join(root, y))) {
        for (const d of safeList(path.join(root, y, m))) {
          for (const f of safeList(path.join(root, y, m, d))) {
            if (f.endsWith(suffix)) return true
          }
        }
      }
    }
  } catch {
    /* 没装 codex / 没跑过 */
  }
  return false
}

/** omp：会话目录按 cwd 编码分子目录，里面的文件/目录名含 id。深度有限，逐层找。 */
function isOmp(id: string, o: OwnerLookupPaths): boolean {
  const root = path.join(o.userData, 'omp', 'agent', 'sessions')
  try {
    for (const bucket of fs.readdirSync(root)) {
      const dir = path.join(root, bucket)
      for (const entry of safeList(dir)) {
        if (entry.includes(id)) return true
        // 再往下一层（omp 可能按会话再建一级目录）
        for (const inner of safeList(path.join(dir, entry))) {
          if (inner.includes(id)) return true
        }
      }
    }
  } catch {
    /* 没跑过 omp */
  }
  return false
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * 查这个 resumeId 是谁签发的。
 *
 * @returns 找到就返回签发者；三处都没有返回 `null`（会话被清理了 / 换了机器）。
 *          **id 形状不对也返回 null**，不抛 —— 调用方拿 null 当「不知道」处理即可。
 *
 * 顺序：claude → codex → omp。三者的存放位置互不重叠，命中即返回；
 * 理论上一个 id 不会同时出现在两处（UUID），真出现了取第一个也不会更糟。
 */
export function resumeOwnerOf(resumeId: string, cwd: string, o: OwnerLookupPaths): ResumeOwner | null {
  if (!SAFE_ID.test(resumeId)) return null
  if (isClaude(resumeId, cwd, o)) return 'claude'
  if (isCodex(resumeId, o)) return 'codex'
  if (isOmp(resumeId, o)) return 'omp'
  return null
}
