#!/usr/bin/env node
// `npm run dist:ci` 只给 Windows CI 用：它刻意不编原生灵动岛宿主（build-island-helper 只在 mac 的 `npm run dist` 里跑），
// 在 mac 上跑会一路打到 afterSign 才被 build/notarize.js 的宿主签名闸门拦下，报错还看不出是「命令用错了」。
// 所以开头就拦：mac 打包用 `EAS_NOTARIZE=1 npm run dist`（0.4.122 审查遗留）。
if (process.platform === 'darwin') {
  console.error('[dist:ci] ✗ 这是 Windows CI 的打包命令，不编原生灵动岛宿主，mac 上打出来的包会被签名闸门拦下。')
  console.error('          mac 请用：EAS_NOTARIZE=1 npm run dist（见 .agents/skills/release/SKILL.md）')
  process.exit(1)
}
