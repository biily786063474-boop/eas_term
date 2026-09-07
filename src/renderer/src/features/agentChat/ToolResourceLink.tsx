import { useEffect, useState } from 'react'
import type { ChatResource } from '../../../../shared/agentChat'
import type { PluginInfo } from '../../../../shared/types'
import { useStore } from '../../store'
import { externalResourceUrl, resourcePanel } from './resourceLink'
import { openUrl } from './useLinkify'

export function ResourceLink({ resource, pluginId, leafId }: { resource: ChatResource; pluginId?: string; leafId?: string }): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  useEffect(() => {
    let active = true
    if (pluginId && resource.uri.startsWith('ui://')) {
      void window.api.plugins.list().then(p => { if (active) setPlugins(p) }).catch(() => { if (active) setPlugins([]) })
    }
    return () => { active = false }
  }, [pluginId, resource.uri])
  const url = externalResourceUrl(resource.uri)
  const target = resourcePanel(resource.uri, pluginId, plugins)
  if (!url && !target) return <span title={resource.uri}>{resource.name} · 资源不可打开</span>
  const open = (): void => {
    if (url) { openUrl(url, leafId); return }
    if (!target) return
    const st = useStore.getState()
    const frame = st.canvas.frames.find(f => f.nodes.some(n => n.leafId === leafId))
    if (!frame) return
    const { plugin, panel } = target
    st.addComponentNode(frame.id, 'plugin-panel', 40, 80, panel.defaultSize.w, panel.defaultSize.h, {pluginId:plugin.id,panelId:panel.id})
    // 交由现有 PluginPanel 完成 resources/read、握手和权限检查。
    st.setMaximizedNode(null)
  }
  return <button type="button" className="ac-resource-link" onClick={open}>{resource.name} ↗</button>
}
