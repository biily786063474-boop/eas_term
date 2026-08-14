// adapter 注册表。就是一个数组加两个查询函数——**这里不许写任何 CLI 特有逻辑**
// （不许出现 `if (id === 'claude')` 这类分支）。加一个新 CLI = 新增一个 adapter 文件
// + 在下面的数组里补一行，UI 不用改一行。这条判据是整个「通用前端」能不能成立的关键。

import type { CliAdapter } from '../../../shared/agentChat.ts'
import { claudeAdapter } from './claude.ts'
import { codexAdapter } from './codex.ts'

const ADAPTERS: CliAdapter[] = [claudeAdapter, codexAdapter]

export function listAdapters(): CliAdapter[] {
  return ADAPTERS
}

export function getAdapter(id: string): CliAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id)
}
