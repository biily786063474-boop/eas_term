// 契约自检的副作用那一半：跑 --help / --version、读写指纹、决定要不要出声。
// 判定逻辑全在 cliContract.ts（纯函数、可测），这里只负责「去撞」和「记住撞的结果」。
//
// **自检本身必须是廉价且无副作用的**：只跑 --help 和 --version。
// 绝不能跑会启动交互会话的子命令 —— agent.ts 那条注释记着教训
// （曾误用 `claude config list` 启动了真实会话）。
import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

import { PROBE_ENV } from './probeEnv'
import {
  verdictOf,
  shouldWarn,
  mergeRecord,
  type CliContract,
  type ContractRecord,
  type Verdict
} from './cliContract'

const pExecFile = promisify(execFile)



const home = (): string => app.getPath('home')

/**
 * 两个 CLI 的契约。
 *
 * **只写「功能真的依赖它」的那几样。** 多写一条就多一个假警报来源，
 * 而假警报会让人学会无视整个机制 —— 那比不做还糟。
 */
export function contracts(): CliContract[] {
  return [
    {
      id: 'claude',
      bin: 'claude',
      help: [
        // 会话驱动（面 6）靠这三个 flag，任一没了 headless 就起不来
        { name: '--input-format', pattern: /--input-format/ },
        { name: '--output-format', pattern: /--output-format/ },
        { name: '--strict-mcp-config', pattern: /--strict-mcp-config/ },
        // 模型/强度选择器的数据来源（agent.ts 的 probeClaude 解析它们）
        { name: '--model', pattern: /--model/ },
        { name: '--effort', pattern: /--effort/ }
      ],
      configFile: path.join(home(), '.claude.json'),
      skillDir: path.join(home(), '.claude', 'skills', 'eas-term')
    },
    {
      id: 'codex',
      bin: 'codex',
      // codex 的 --help 很短，只钉住我们真正用的子命令
      help: [{ name: 'exec 子命令', pattern: /\bexec\b/ }],
      configFile: path.join(home(), '.codex', 'config.toml'),
      ruleFile: path.join(home(), '.codex', 'AGENTS.md')
    }
  ]
}

const storeFile = (): string => path.join(app.getPath('userData'), 'cli-contracts.json')

function loadRecords(): Record<string, ContractRecord> {
  try {
    const v = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ContractRecord>) : {}
  } catch {
    return {}
  }
}

function saveRecords(r: Record<string, ContractRecord>): void {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(r, null, 2))
  } catch (e) {
    console.error('[cliContract] 指纹写入失败（下次自检会当成初次见面）', e)
  }
}

async function probe(bin: string): Promise<{ help: string | null; version: string }> {
  let help: string | null = null
  let version = ''
  try {
    const r = await pExecFile(bin, ['--help'], { timeout: 8000, env: PROBE_ENV })
    help = r.stdout + r.stderr // 有些 CLI 把 help 写 stderr
  } catch (e) {
    // 跑不起来分两种：命令不存在（没装）vs 跑了但退非零（装了、help 可能仍在 stderr）
    const out = String((e as { stdout?: string; stderr?: string }).stdout ?? '') +
      String((e as { stderr?: string }).stderr ?? '')
    help = out.trim() ? out : null
  }
  try {
    const r = await pExecFile(bin, ['--version'], { timeout: 5000, env: PROBE_ENV })
    version = (r.stdout || r.stderr).trim().split('\n')[0] ?? ''
  } catch {
    version = ''
  }
  return { help, version }
}

export interface ContractCheck {
  id: string
  verdict: Verdict
  /** 这次要不要打扰用户 */
  warn: boolean
  /** 我们写东西的那几个落点，现在还在不在 —— 写进去 ≠ 生效，落点没了就是白写 */
  paths: { what: string; path: string; exists: boolean }[]
}

/** 跑一遍自检。**不抛异常** —— 自检本身失败不该影响任何功能。 */
export async function checkContracts(): Promise<ContractCheck[]> {
  const prev = loadRecords()
  let next = prev
  const out: ContractCheck[] = []
  for (const c of contracts()) {
    const { help, version } = await probe(c.bin)
    const verdict = verdictOf(c, help, version)
    const warn = shouldWarn(prev[c.id]?.fingerprint, verdict)
    next = mergeRecord(next, c.id, verdict, Date.now())
    const paths: ContractCheck['paths'] = []
    const add = (what: string, p?: string): void => {
      if (p) paths.push({ what, path: p, exists: fs.existsSync(p) })
    }
    // 只在装了的时候查落点：没装的 CLI 落点当然不存在，报出来是噪音
    if (verdict.k !== 'absent') {
      add('配置', c.configFile)
      add('常驻指引', c.ruleFile)
      add('skill 目录', c.skillDir)
    }
    out.push({ id: c.id, verdict, warn, paths })
  }
  saveRecords(next)
  return out
}
