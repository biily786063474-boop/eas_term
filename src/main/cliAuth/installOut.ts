// 安装器输出的清洗。**单独成文件是为了能被 node --test 直接跑**
//（install.ts 引了 electron，加载不了）—— 同 redact.ts 从 log.ts 拆出来的理由。
//
// 这一层看着琐碎，但它决定了进度条上那行字是「正在下载 claude-code…」
// 还是一串控制字符残影。

/** 终端控制序列。**不只是颜色** —— 安装器还会发光标移动、清行（\[2K）、
 *  隐藏光标（\[?25l）这些，只挡 `[0-9;]*m` 会把它们原样显示出来 */
// eslint-disable-next-line no-control-regex
export const ANSI = /\[[0-9;?]*[A-Za-z]/g

/**
 * 从一段输出里取「最后一句有意义的话」，给进度条当当前步骤。
 *
 * **必须按 \r 也切开。** 下载进度条是靠回车覆盖同一行实现的：
 * 一个 chunk 里可能是 `10%\r20%\r30%`，只按 \n 切会得到 `10%20%30%` 这种残影，
 * 而用户看到的应该是 `30%`。
 */
export function lastLine(s: string, max = 160): string {
  const parts = s
    .replace(ANSI, '')
    .split(/[\r\n]+/)
    .filter((l) => l.trim())
  return (parts[parts.length - 1] ?? '').trim().slice(0, max)
}

/** 把一段输出拆成干净的行，供失败时回显。空行丢掉、控制序列去掉 */
export function outLines(s: string): string[] {
  return s
    .replace(ANSI, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 安装到底成没成。**纯函数，因为这里错过一次**（2026-08-30 真机验证抓到）。
 *
 *  第一版写成「只看命令在不在」，理由是「退出码 0 不等于装上了」——
 *  那句话本身没错，但据此把退出码**整个忽略**是矫枉过正：
 *  在一台本来就装着这个 CLI 的机器上，安装命令以 243 退出（权限失败、
 *  磁盘满、网断），我们照样报「装好了」。用户什么都没看到，
 *  而他刚才那次安装/升级其实是失败的。
 *
 *  两条判据都要，各挡各的：
 *  · 退出码非 0 → 失败。**安装器自己说它失败了，没有理由替它翻案**
 *  · 退出码 0 但命令找不到 → 也失败（装到了不在 PATH 的地方，这是最常见的静默坏法）
 */
export function installVerdict(
  code: number | null,
  installed: boolean
): { ok: true } | { ok: false; error: string } {
  if (code !== 0 && code !== null) {
    return { ok: false, error: `安装没成功（退出码 ${String(code)}），下面是安装器的输出` }
  }
  if (!installed) {
    return { ok: false, error: '装完了却找不到这个命令（可能没进 PATH，重启软件再试）' }
  }
  return { ok: true }
}
