// 终端里那些「看起来像路径」的字串，怎么解析成绝对路径。
// **纯函数、零 IO，能单测**（fs.ts 引了一堆 electron，`node --test` 加载不了）。
//
// ── 为什么单独拆出来（2026-08-30）────────────────────────────────
// 用户报「Windows 上卡死未响应，卡顿往往出现在 hover 了终端中的超链接」。
// 查出来是 `fs:probePaths` 在**主进程**里用 `statSync`：
// 鼠标每划过终端一行就调一次，一行最多 15 个候选 —— 也就是主进程里
// 最多 15 次同步 stat。macOS 上感觉不到，Windows 上：
//   · NTFS 的 stat 本来就比 APFS 慢
//   · Defender 实时扫描要挂钩每一次文件操作
//   · 候选里只要有一个指向网络盘或不存在的 UNC 路径，statSync 能阻塞好几秒
// 而它跑在 ipcMain.handle 里，卡住的是主进程 —— 表现就是「应用未响应」。
//
// 修法是「改异步 + 加缓存」，而解析这部分本来就没有 IO，
// 顺手拆出来让它能被测到 —— 它的规则（去掉 :行:列、认 ~、认 file://）
// 之前一条测试都没有。

/** 一行里最多认几个候选。**上限不是省事，是止血**：
 *  一行长命令能拆出几十个词，每个都去 stat 一遍，鼠标划过去就是几十次文件操作。 */
export const MAX_CANDIDATES = 15

/**
 * 把终端里的一个 token 解析成绝对路径。**不碰文件系统** —— 存不存在由调用方去查。
 *
 * @param base 相对路径的基准（终端的实时 cwd）。不是绝对路径时调用方应传 home。
 * @returns 绝对路径；输入为空或无法解析时返回 null
 */
export function resolveProbePath(
  input: string,
  base: string,
  helpers: {
    /** path.isAbsolute */
    isAbsolute: (p: string) => boolean
    /** path.resolve */
    resolve: (a: string, b: string) => string
    /** path.join */
    join: (a: string, b: string) => string
    /** os.homedir */
    home: () => string
    /** url.fileURLToPath */
    fromFileUrl: (u: string) => string
  }
): string | null {
  let p = String(input ?? '').trim()
  if (!p) return null
  if (p.startsWith('file://')) {
    try {
      return helpers.fromFileUrl(p)
    } catch {
      return null
    }
  }
  // 去掉编译器 / grep 常见的 `:行` 或 `:行:列` 后缀 ——
  // `src/a.ts:42:8` 指的是 `src/a.ts`
  p = p.replace(/:(\d+)(:\d+)?$/, '')
  if (!p) return null
  if (p === '~') return helpers.home()
  if (p.startsWith('~/')) return helpers.join(helpers.home(), p.slice(1))
  if (helpers.isAbsolute(p)) return p
  return helpers.resolve(base, p)
}

/** 探测结果。null = 这个路径不存在（或读不到） */
export interface ProbeHit {
  absPath: string
  isDir: boolean
}

/**
 * 带上限和过期的探测结果缓存。
 *
 * **为什么要缓存**：鼠标在终端里移动时，同一行会被反复 provideLinks，
 * 同一批路径于是被反复 stat。缓存把「鼠标划过一整屏」的文件操作数
 * 从「行数 × 15」降到「不同路径数」。
 *
 * **为什么 TTL 要短**：路径会变（构建产物刚生成、文件刚被删）。
 * 几秒足够覆盖一次鼠标移动，又不会让「文件已经生成了但链接还是灰的」持续太久。
 */
export function createProbeCache(ttlMs = 4000, max = 600) {
  const hits = new Map<string, { at: number; v: ProbeHit | null }>()
  return {
    get(key: string, now: number): { v: ProbeHit | null } | undefined {
      const e = hits.get(key)
      if (!e) return undefined
      if (now - e.at > ttlMs) {
        hits.delete(key)
        return undefined
      }
      return { v: e.v }
    },
    set(key: string, v: ProbeHit | null, now: number): void {
      if (hits.size >= max) {
        // 丢最旧的一条。Map 的迭代顺序就是插入顺序，够用了
        const oldest = hits.keys().next().value
        if (oldest !== undefined) hits.delete(oldest)
      }
      hits.set(key, { at: now, v })
    },
    size(): number {
      return hits.size
    }
  }
}
