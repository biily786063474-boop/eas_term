// 两份必读图纸的体积上限（npm run check 的一环）。
//
// 10-模块领地图.md 与 03-agent角色边界.md 是每个 agent 改代码前都要读的。2026-09-30 拆分前，
// 因为「改了代码顺手在文件首尾追加一段带日期的说明」，两份涨到约 10 万 token —— 每个会话、每个子代理都要先付这一笔。
// 拆分后它们只留索引与红线；新内容写进分册（10a/10b/10c/10d、03a/03b）再在索引里加一行。
// 超限就说明又有人往必读文件里堆正文了：挪进分册，别调高上限。
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '../docs/architecture')
const LIMITS = { '10-模块领地图.md': 32 * 1024, '03-agent角色边界.md': 32 * 1024 }
let bad = false
for (const [name, limit] of Object.entries(LIMITS)) {
  const size = fs.statSync(path.join(dir, name)).size
  if (size > limit) {
    bad = true
    console.error(`✗ check-arch-size：${name} ${Math.round(size / 1024)}KB，超过上限 ${limit / 1024}KB —— 这是每个 agent 的必读文件，正文请写进分册（见 docs/architecture/README.md），这里只加一行索引`)
  }
}
if (bad) process.exit(1)
console.log('✓ check-arch-size：两份必读图纸在体积上限内')
