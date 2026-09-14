// 「定位」的纯函数部分：服务 id → 画布上的模块。主进程给的 id 里带 ptyId / sessionId，
// 渲染层的 leaf pane 里正好也有（layout.ts PaneState）。找不到就 null，按钮置灰。
// 不 import store（store 带 React / window），`node --test` 裸跑；带副作用的在 runtimeLocateActions.ts。
import { collectLeaves, type LayoutNode } from '../../layout.ts'
import { serviceLeafRef } from './runtimeView.ts'

interface TabLike { root: LayoutNode }
interface FrameLike { id: string; nodes: readonly { id: string; leafId?: string }[] }

export function findServiceNode(serviceId: string, tabs: readonly TabLike[], frames: readonly FrameLike[]): { frameId: string; nodeId: string } | null {
  const ref = serviceLeafRef(serviceId)
  if (!ref) return null
  const leaf = tabs.flatMap((t) => collectLeaves(t.root)).find((l) =>
    ref.kind === 'terminal' ? l.pane.kind === 'terminal' && l.pane.ptyId === ref.ptyId
      : l.pane.kind === 'agent' && l.pane.sessionId === ref.sessionId)
  if (!leaf) return null
  for (const f of frames) {
    const n = f.nodes.find((x) => x.leafId === leaf.id)
    if (n) return { frameId: f.id, nodeId: n.id }
  }
  return null
}
