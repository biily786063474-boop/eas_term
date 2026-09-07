// 角色章程 docs/roles/<roleId>.md：首次在某项目用某角色 → 生成初稿。
// **已存在就一个字节不动** —— 用户会改它，我们只负责给第一版。
//
// 同步 fs：调用点 agentChat:start 是同步 handler。**不 import electron**，以后能裸测
//（见 collabBoard.test.ts 文件头为什么这条要紧）。文本模板住在 shared/roleDocs.ts。
import fs from 'fs'
import path from 'path'

import {
  capMatrix,
  CAP_LABEL,
  HARNESS_LABEL,
  LEVEL_LABEL,
  type BindingContext,
  type RoleBounds
} from '../shared/roleBinding.ts'
import { charterRel, renderCharter } from '../shared/roleDocs.ts'
import type { HarnessId } from '../shared/types'

/** 绑定层「硬约束」几行：点亮的 cap × **当前这家** harness 的落法（`row.cells[kind]`）。
 *  三家都列会把「Claude hook 拦」「Codex 摘 skill」并排写进一份只生成一次的文件，读的人分不清
 *  哪条是此刻真在执行的；只写起会话那家，另加一行说明换 CLI 时以角色卡为准。
 *  `capMatrix` 未点亮的意图行也会给「假设点亮」的预览，这里只取 active 的 —— 章程写的是
 *  这张卡**真的**限制了什么，不是它能限制什么。
 *  `ctx` 必须是起会话时喂给 `bindRole` 的那一份：章程只生成一次、永不重写，
 *  拿默认 ctx 算出来的「降级」措辞会和真实绑定（比如 Codex 拿到 codexHome 后升 hard）对不上。 */
function hardLines(bounds: RoleBounds | undefined, kind: HarnessId, ctx: BindingContext | undefined): string[] {
  const out: string[] = []
  for (const row of capMatrix(bounds, ctx)) {
    if (!row.active) continue
    const cell = row.cells[kind]
    if (!cell) continue
    out.push(`${CAP_LABEL[row.cap]} · ${HARNESS_LABEL[kind]}：${cell.how}（${LEVEL_LABEL[cell.level]}）`)
  }
  return out
}

/** **`root` 必须是项目根**（调用方先 `projectRootOf`），且那里得真有个仓库：
 *  `<root>/.git` 不存在（文件或目录都算存在）→ 返回 `null`，一个字节不写 ——
 *  否则传错目录会在 `$HOME` 之类的地方凭空长出一份 `docs/roles/`。
 *  另一种 `null`：roleId 不合法（`charterRel` 拒收），那就没有章程这回事。
 *  写不出来（只读目录、磁盘满）返回 `created: false` —— 指针照附进系统提示，
 *  模型读不到会自己说，比起会话前先弹个错强。 */
export function ensureCharter(
  root: string,
  role: { roleId: string; roleName: string; contract: string; bounds?: RoleBounds },
  kind: HarnessId,
  ctx?: BindingContext
): { created: boolean; rel: string } | null {
  const rel = charterRel(role.roleId)
  if (!rel) return null
  if (!fs.existsSync(path.join(root, '.git'))) return null
  const abs = path.join(root, rel)
  if (fs.existsSync(abs)) return { created: false, rel }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.tmp`
    fs.writeFileSync(
      tmp,
      renderCharter({
        roleId: role.roleId,
        roleName: role.roleName,
        contract: role.contract,
        hardLines: hardLines(role.bounds, kind, ctx),
        hardNote: `（按首次起会话的 ${HARNESS_LABEL[kind]} 算；换别家 CLI 时落法可能不同，以角色卡为准）`
      })
    )
    fs.renameSync(tmp, abs)
    return { created: true, rel }
  } catch {
    return { created: false, rel }
  }
}
