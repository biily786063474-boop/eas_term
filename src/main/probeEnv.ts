// 探测子进程用的环境。**只有一份，谁要探测谁引它。**
//
// ── 为什么必须共用 ────────────────────────────────────────────────────
// 从 Dock / Finder 启动的 Electron，其 PATH 是 launchd 给的那份精简版，
// **不含 /opt/homebrew/bin**（终端里能跑是因为 pty 走登录 shell，会读 ~/.zshrc）。
// 所以直接 execFile('which', ['claude']) 会说「没装」，而它明明装着。
//
// 这个补丁原来只写在 agent.ts 里，`agentChat/adapters/detect.ts` 没有 ——
// 于是 AI 对话面板从 Dock 启动时报「没有探测到可用的 CLI」，
// 而同一台机器上「扩展能力」面板却显示 claude/codex 都在。同一个事实写两处，
// 漏的那处只在特定启动方式下暴露，开发时从终端起实例永远测不出来。
//
// 2026-08-18 用户报「会话怎么坏了」时才发现。抽到这里之后，
// 新增探测点直接 import，不会再各写一份。
export const PROBE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`
}
