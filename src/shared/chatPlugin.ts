import type { PluginInfo } from './types'
export interface ChatPluginState {
  id: string
  name: string
  status: 'selected' | 'missing'
  note: string
}
/** 已安装清单只能证明存在；不把它伪装成认证/连接/工具可用的事实。 */
export function chatPluginState(id: string, plugin?: Pick<PluginInfo, 'displayName'>): ChatPluginState {
  return plugin
    ? { id, name: plugin.displayName, status: 'selected', note: '本会话选择的插件；连接与工具可用性以实际调用结果为准' }
    : { id, name: id, status: 'missing', note: '未在已安装清单中找到，可能已移除或无法读取' }
}
