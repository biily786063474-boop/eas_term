// CLI 契约自检：把「我以为这个 CLI 长这样」写成可执行的断言，让它自己去撞。
//
// ── 要解决的是哪一类失败 ──────────────────────────────────────────────
// CLI 升级改接口时，坏法分两类。**会响的那类不用管**（headless flag 没了 →
// 进程起不来 → error 事件 → 用户立刻看见）。麻烦的全是静默那类：
//
//   `--help` 措辞变    → 模型/effort 列表解析成空 → 看起来像「没装」
//   配置结构变         → 写进去了但 CLI 不认   → agent 说「我没有这个工具」
//   常驻区文件改名     → 写进了没人读的文件     → agent 不知道自己有这些能力
//
// 三条都不报错。用户只看到「功能坏了」，看不到「为什么」。
//
// ── 三条纪律 ─────────────────────────────────────────────────────────
// 1. **探测失败必须区分「没装」和「装了但对不上」。** 现在 agent.ts 的 probeClaude
//    把两者都返回 `installed: false` —— 信息就是在那里丢掉的，后面再想补也补不回来。
// 2. **写配置前验落点、写完读回来。** 写进去 ≠ 生效。
// 3. **指纹没变就完全不出声。** 这条是「少人为监管」的关键：不要求用户定期做任何事，
//    自检在自然时机自动跑，只有真漂移了才打扰他。
//
// 这个文件只放判定逻辑，**零 import**，node --test 直接跑。
// 跑 --help、读写指纹文件那些副作用在 cliContractRun.ts。

/** 一条要在 `--help` 里找到的东西。找不到就是「装了但对不上」。 */
export interface HelpProbe {
  /** 给人看的名字，出现在提示里：「claude 的 --effort 找不到了」 */
  name: string
  /** 匹配 --help 全文的正则。**只用来判在不在，不参与解析** ——
   *  解析（比如抓出有哪些 effort 档）是 agent.ts 的事，那边失配只影响列表内容，
   *  这里失配意味着整个契约不成立。 */
  pattern: RegExp
}

export interface CliContract {
  id: string
  /** 二进制名，探测与 --help 都用它 */
  bin: string
  /** 这些必须都能在 --help 里找到 */
  help: HelpProbe[]
  /** 我们会写配置的文件（绝对路径）。空 = 这个 CLI 不写配置 */
  configFile?: string
  /** 我们会写常驻指引的文件（绝对路径） */
  ruleFile?: string
  /** 我们会往里放 skill 的目录（绝对路径） */
  skillDir?: string
}

/** 自检结论。**三种状态，不是布尔** —— 「没装」和「装了但对不上」必须分开，
 *  它们对用户意味着完全不同的两件事（去装 vs 我们的适配过期了）。 */
export type Verdict =
  | { k: 'absent' }
  | { k: 'ok'; version: string; fingerprint: string }
  | { k: 'drift'; version: string; fingerprint: string; missing: string[] }

/**
 * 契约指纹：版本号 + 每条 help 探针的命中情况。
 *
 * **刻意不把 --help 全文哈希进去。** 全文里有版本号、有随时会改的措辞，
 * 哈希全文等于每次小版本升级都报一次漂移 —— 那就成了狼来了，用户很快学会无视它。
 * 只记「我们依赖的那几样还在不在」，那才是真正会影响功能的东西。
 */
export function fingerprintOf(version: string, help: HelpProbe[], helpText: string): string {
  const hits = help.map((p) => `${p.name}=${p.pattern.test(helpText) ? '1' : '0'}`)
  return `${version}|${hits.join(',')}`
}

/**
 * 判定一次自检的结论。
 *
 * @param helpText  `<bin> --help` 的输出；null = 命令跑不起来
 * @param version   `<bin> --version` 的输出；跑不起来给空串
 */
export function verdictOf(contract: CliContract, helpText: string | null, version: string): Verdict {
  if (helpText === null) return { k: 'absent' }
  const missing = contract.help.filter((p) => !p.pattern.test(helpText)).map((p) => p.name)
  const fingerprint = fingerprintOf(version, contract.help, helpText)
  return missing.length ? { k: 'drift', version, fingerprint, missing } : { k: 'ok', version, fingerprint }
}

/**
 * 这次自检要不要打扰用户。
 *
 * **只有「上次好好的、这次不对了」才出声。** 一直是 drift 的（比如用户装了个
 * 我们还没适配的老版本）第一次说过就够了，每次启动都弹是骚扰。
 * 从没记录过的（第一次自检）也不出声 —— 那不是漂移，是初次见面。
 */
export function shouldWarn(prev: string | undefined, now: Verdict): boolean {
  if (now.k !== 'drift') return false
  if (prev === undefined) return false
  return prev !== now.fingerprint
}

/** 存盘用的形状。一个 CLI 一条。 */
export interface ContractRecord {
  fingerprint: string
  /** 上次自检的时刻（ms），只为排查时看得出新鲜度 */
  checkedAt: number
  /** 上次是不是通过的 —— 用来区分「一直没适配」和「刚坏的」 */
  ok: boolean
}

/** 合并一次自检结果到存盘记录里。没装的不写记录（下次装上是初次见面，不该报漂移）。 */
export function mergeRecord(
  prev: Record<string, ContractRecord>,
  id: string,
  v: Verdict,
  now: number
): Record<string, ContractRecord> {
  if (v.k === 'absent') {
    const { [id]: _drop, ...rest } = prev
    return rest
  }
  return { ...prev, [id]: { fingerprint: v.fingerprint, checkedAt: now, ok: v.k === 'ok' } }
}
