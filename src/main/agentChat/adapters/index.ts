// adapter 注册表。就是一个数组加两个查询函数——**这里不许写任何 CLI 特有逻辑**
// （不许出现 `if (id === 'claude')` 这类分支）。加一个新 CLI = 新增一个 adapter 文件
// + 在下面的数组里补一行，UI 不用改一行。这条判据是整个「通用前端」能不能成立的关键。

import type { CliAdapter } from '../../../shared/agentChat.ts'
import { claudeAdapter } from './claude.ts'
import { codexAdapter } from './codex.ts'
import { ompAdapter } from './omp.ts'

/** **顺序有意义，omp 必须排最后。**
 *
 *  三条路都取「第一个可用的 CLI」：`AgentChatView.tsx` 的空态默认、手机端
 *  `phone/provider.ts`、团队派活。omp 是随包的、`available` 恒真 —— 排前面会让
 *  **只登了 Claude 的老用户**升级当天每个新会话都被换成 omp。
 *  这条由 `adapters.test.ts` 的一条断言钉住（判据是 `bundled` 能力位，不是 id）。 */
const ADAPTERS: CliAdapter[] = [claudeAdapter, codexAdapter, ompAdapter]

export function listAdapters(): CliAdapter[] {
  return ADAPTERS
}

export function getAdapter(id: string): CliAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id)
}
