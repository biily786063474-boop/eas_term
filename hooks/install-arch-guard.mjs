#!/usr/bin/env node
/**
 * 把「图纸守门」装进本项目的 `.claude/settings.json`。
 *
 *     node hooks/install-arch-guard.mjs          # 装 / 更新
 *     node hooks/install-arch-guard.mjs --off    # 卸
 *
 * 为什么需要这个脚本：`.claude/settings.json` **不进版本库**（里面是这台机器的
 * 绝对路径），所以换机器 / 重新 clone 之后那道闸不会自己回来。跑一次这个补上。
 *
 * **合并式写入，只认自己那条 marker。** 同一个文件里还躺着 app 自己写的审批
 * hook（`agentChat/session.ts` 的 `installApprovalHook`，matcher `*`）——
 * 那是审批链路，删了等于这个项目的 agent 会话失去工具审批保护，
 * 而且**不会报错、没有任何用户可见信号**。所以这里逐条比对，绝不整体覆写。
 *
 * 幂等：重复跑不会写出第二条；路径变了（换目录 / 换 node）会就地更新那一条。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, '.claude', 'settings.json')
/** 认领自己那条 hook 用的标记。**按脚本名认，不按整条命令认** ——
 *  否则换了 node 路径就会被当成别人的条目，于是越装越多。 */
const MARK = 'hooks/arch-guard.mjs'
const COMMAND = `"${process.execPath}" "${join(ROOT, 'hooks', 'arch-guard.mjs')}"`

const read = () => {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return {} // 不存在或坏了都当空对象——绝不因为读不出来就放弃合并、整体覆写
  }
}

const cfg = read()
cfg.hooks ??= {}
const groups = (cfg.hooks.PreToolUse ??= [])

// 找自己那条：按 marker 找，不按 matcher 找（app 那条 matcher 是 `*`，我们是 `Bash`，
// 但别人将来也可能用 `Bash`，所以判据只能是命令里带没带我们的脚本名）
let mine = null
for (const g of groups) {
  for (const h of g.hooks ?? []) {
    if (typeof h.command === 'string' && h.command.includes(MARK)) mine = { g, h }
  }
}

if (process.argv.includes('--off')) {
  if (!mine) {
    console.log('本来就没装，什么都没动。')
    process.exit(0)
  }
  mine.g.hooks = mine.g.hooks.filter((h) => h !== mine.h)
  // 组里没别的 hook 了就把空组也去掉，别留垃圾
  if (mine.g.hooks.length === 0) cfg.hooks.PreToolUse = groups.filter((g) => g !== mine.g)
  if (cfg.hooks.PreToolUse.length === 0) delete cfg.hooks.PreToolUse
  writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n')
  console.log('已卸下图纸守门。app 写的审批 hook 没动。')
  process.exit(0)
}

if (mine) {
  if (mine.h.command === COMMAND) {
    console.log('已经装着且路径是对的，没动。')
    process.exit(0)
  }
  mine.h.command = COMMAND
  writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n')
  console.log('路径变了，已就地更新：\n  ' + COMMAND)
  process.exit(0)
}

groups.push({ matcher: 'Bash', hooks: [{ type: 'command', command: COMMAND }] })
mkdirSync(dirname(FILE), { recursive: true })
writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n')
console.log('已装上图纸守门（PreToolUse · matcher Bash）：\n  ' + COMMAND)
console.log('\n下次 git commit 时，若改动碰了图纸描述的事实而 docs/architecture/ 没动，就会被挡下。')
console.log('确实不需要动图纸时，commit message 里写 [skip-arch]。')
