// CLI 非零退出时，从 stderr 尾巴里挑一句**能给人看的原因**。纯函数，有测试。
//
// 2026-09-05 正式版：Codex 在非 git 目录秒退，界面只有「CLI 进程退出（code 1）」——
// 原因（`Not inside a trusted directory and --skip-git-repo-check was not specified`）
// 其实就躺在 stderr 里，用户看不到，我得手动跑命令才找到。「失败要说人话」：
// 分类 + 一句原因，这里补的是那一句原因。

/** 这些是噪声不是原因：每次都会出现，或者是没有信息量的进度行 */
const NOISE = [/^Reading additional input from stdin/i, /^\s*$/]

export function stderrReason(tail: string, max = 160): string {
  const lines = tail
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.some((re) => re.test(l)))
  if (!lines.length) return ''
  // 去掉日志前缀的时间戳 / 级别（`2026-09-06T02:12:52Z ERROR mod::x: msg` → `msg`）
  const last = lines[lines.length - 1].replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+(ERROR|WARN|INFO)\s+[\w:]+:\s*/i, '')
  return last.length > max ? last.slice(0, max - 1) + '…' : last
}

/** 退出通知的正文：有原因就带上，没有就只报退出码 */
export function exitMessage(code: number, tail: string): string {
  const why = stderrReason(tail)
  return why ? `CLI 进程退出（code ${code}）：${why}` : `CLI 进程退出（code ${code}）`
}
