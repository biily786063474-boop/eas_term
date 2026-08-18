// 共享给每个 adapter 的「PATH 里有没有这个可执行文件」探测。原来 WHICH_BIN 常量 +
// detectByWhich() 函数在 claude.ts / codex.ts 里逐字节重复——第三个 adapter 接进来会
// 复制第三遍（2026-08-14 全分支评审 I6 第 3 点）。这里只做这一件事，不涉及任何 CLI
// 特有逻辑，谁都能引用。

import { execFile } from 'node:child_process'

import { PROBE_ENV } from '../../probeEnv.ts'

/** 用 `which`（Windows 上是 `where`）判断 PATH 里有没有这个可执行文件。
 *  没选择跑 `<bin> --version`：那样会真的启动一次 CLI 进程，有版本检查/网络请求等
 *  副作用的风险，`which` 只查 PATH，快且没有副作用。 */
const WHICH_BIN = process.platform === 'win32' ? 'where' : 'which'

export function detectByWhich(bin: string): () => Promise<boolean> {
  return () =>
    new Promise((resolve) => {
      // **必须带 PROBE_ENV。** 不带的话从 Dock 启动时 PATH 里没有 homebrew，
      // 装着的 CLI 会被判成没装 —— 面板上就是那句「没有探测到可用的 CLI」。
      execFile(WHICH_BIN, [bin], { env: PROBE_ENV }, (err) => resolve(!err))
    })
}
