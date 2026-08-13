// 「拍一张画板」的唯一实现，两条调用路径共用：
//   · 工具条上的相机按钮（CanvasStage.takeSnapshot）
//   · agent 的 MCP 工具 canvas_snapshot（mcpHandler）
//
// 合成一份的原因：`.snapshotting`（那 16 条藏浮层的 CSS 的开关）原来有**两个各自
// add/remove 的主人**。按钮那条有组件内 state snapBusy 挡自己，但 mcpHandler 在
// 组件树外，读不到那个 state。于是「按钮拍照进行中 → agent 也调一次 canvas_snapshot →
// 先完成的那条 finally 把 class 摘掉」→ 另一条的 capturePage 拍到抽屉、工具条、
// 小地图全在的画面，16 条隐藏清单在那一瞬全部作废。这里改成**引用计数**：
// 最后一个走的人才熄灯。以后再多一条拍照路径也不会重演。
//
// 顺带把两件「拍之前必须做」的事收在这里，两条路都不会再漏：
//   · 正在编辑的便签先落盘再卸载（见 commitEditingSticky）
//   · 「现在能不能拍」的判断（见 snapshotBlockedReason）

import { useStore } from '../../store'
import type { SnapshotRect, SnapshotResult } from '../../../../shared/types'

// ── .snapshotting 的引用计数 ──────────────────────────────────────
let hideRefs = 0

function beginHide(): void {
  hideRefs += 1
  if (hideRefs === 1) document.querySelector('.app')?.classList.add('snapshotting')
}

function endHide(): void {
  hideRefs -= 1
  if (hideRefs <= 0) {
    hideRefs = 0 // 计数不允许变负：真出现不配对的调用也不能让下一次拍照永远藏不掉浮层
    document.querySelector('.app')?.classList.remove('snapshotting')
  }
}

// ── 「现在能不能拍」 ──────────────────────────────────────────────
let clearDialogOpen = false

/** CanvasStage 在「拍完要不要清掉标记」确认框开/关时同步过来（含卸载时置 false） */
export function setClearDialogOpen(open: boolean): void {
  clearDialogOpen = open
}

/**
 * 返回非 null = 现在不该拍，字符串是给人 / 给 agent 看的理由。
 *
 * 那个确认框是 createPortal 到 document.body 的、z-index 3500，而 16 条隐藏规则
 * 全是 `.app.snapshotting xxx` 的后代选择器，够不着它 —— 硬拍会把弹窗原样拍进图。
 * 相机按钮自己有 `disabled={... || pendingClear !== null}` 挡着，MCP 那条路
 * 没有对应的守卫，只能靠这个模块级开关（防线原来只修了一半）。
 */
export function snapshotBlockedReason(): string | null {
  if (clearDialogOpen)
    return '画板上正开着「拍完要不要清掉标记」的确认框，这会儿拍会把那个弹窗一起拍进图里。'
  return null
}

/**
 * 把正在编辑的便签落进 shape，再退出编辑态。
 *
 * 不能只 setEditingSticky(null)：那会把聚焦中的 <textarea> 直接从 DOM 里摘掉，而
 * **Chrome 移除聚焦元素不触发 blur/focusout** —— CanvasShapeLayer 上那个
 * onBlur → updateShape(text) 根本不会跑，用户刚敲的字**静默丢弃**。
 * （相机按钮那条路凑巧没事：点按钮的 mousedown 先让 textarea 失焦、文字已经存下了。
 *   agent 那条路没有任何鼠标事件，必须在这里显式收一次。）
 */
function commitEditingSticky(): void {
  const st = useStore.getState()
  const id = st.editingSticky
  if (!id) return
  const ta = document.querySelector('.cshape-sticky.editing') as HTMLTextAreaElement | null
  if (ta) st.updateShape(id, { text: ta.value })
  st.setEditingSticky(null)
}

/**
 * 拍一张：藏浮层 → 等两帧 → 量 rect → 走 IPC 落盘 → 摘浮层。
 *
 * @param viewportEl 要截的 .canvas-viewport（按钮传自己的 ref，MCP 传等出来的那个）
 * @param projectPath 存进哪个项目的 screenshot/
 * 「拍完清不清标记」不在这里 —— 两条路的策略不同（按钮可能弹确认框，agent 不弹），
 * 由各自的调用方处理。
 */
export async function runCanvasSnapshot(
  viewportEl: Element,
  projectPath: string
): Promise<SnapshotResult> {
  const blocked = snapshotBlockedReason()
  if (blocked) return { ok: false, error: blocked }
  commitEditingSticky()
  beginHide()
  try {
    // 等两帧：加类会触发一次样式重算+绘制，只等一帧可能拍到还没藏掉的那一帧
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const r = viewportEl.getBoundingClientRect()
    const rect: SnapshotRect = { x: r.left, y: r.top, width: r.width, height: r.height }
    return await window.api.canvas.snapshot(projectPath, rect)
  } finally {
    // 不管成功 / 业务失败 / 异常，浮层都必须摘回来——漏了这一步用户的界面会永久少半个 UI
    endHide()
  }
}
