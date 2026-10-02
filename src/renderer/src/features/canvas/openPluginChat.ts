// 「开一个接好这个插件的 AI 对话」——三个入口共用（2026-09-30 用户要求插件用法傻瓜式引导）：
//   Frame 右键「插件」→ 点插件（CanvasStage onPickPlugin）、侧边抽屉点没有面板的插件卡片、插件配置完成后的「开始对话」按钮。
// 插件工具只在**建对话时**按 pane.pluginId 接进会话（主进程 managedSessionMcpServers），已有对话改不了、@ 引用也接不上，
// 所以唯一正确的动作就是新开一个绑定它的对话节点。
// 插件的 defaultPrompt 作为**草稿预填**（draft），不自动发送：原先当 initialMessage 传，选中插件就直接发出一句、先花掉额度，
// 与 shared/types.ts 里「选中插件时预填进对话框」的约定不符。
import { useStore } from '../../store'
import type { PluginInfo } from '../../../../shared/types'

import { pickChatFrame } from './pluginChatFrame'

/** 新开一个绑定 plugin 的对话节点并把画布挪过去。frameId / root 不给就自动挑 */
export async function openPluginChat(plugin: PluginInfo, at?: { frameId: string; root: string }): Promise<{ ok: true } | { ok: false; reason: 'no-frame' }> {
  const st = useStore.getState()
  const target = at ?? pickChatFrame({
    frames: st.canvas.frames, projects: st.projects, canvasSel: st.canvasSel, viewport: st.canvas.viewport,
    view: { w: window.innerWidth, h: window.innerHeight }
  })
  if (!target) return { ok: false, reason: 'no-frame' }
  const leafId = await st.addAgentNode(target.frameId, {
    cwd: target.root,
    // 自家插件（eas）harness 无关：cli 不钉死；Claude / Codex 插件用它所属的 CLI 起会话
    ...(plugin.cli === 'eas' ? {} : { cli: plugin.cli }),
    pluginId: plugin.id,
    ...(plugin.defaultPrompt ? { draft: plugin.defaultPrompt } : {})
  })
  const node = useStore.getState().canvas.frames.find((f) => f.id === target.frameId)?.nodes.find((n) => n.leafId === leafId)
  if (node) useStore.getState().focusCanvasNode(target.frameId, node.id)
  return { ok: true }
}
