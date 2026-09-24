import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PluginInfo } from '../../../../shared/types'
import { PluginPanel } from '../plugins/PluginPanel'
import { useStore } from '../../store'

/** A drawer surface, not a canvas node. The existing plugin sandbox owns the iframe. */
export function PluginDrawerPopup({ plugin, onClose, returnFocus }: {
  plugin: PluginInfo
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement>
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const [panelId, setPanelId] = useState<string | null>(plugin.panels?.length === 1 ? plugin.panels[0].id : null)
  const [size, setSize] = useState({ w: Math.min(plugin.panels?.[0]?.defaultSize.w ?? 900, 1100), h: Math.min(plugin.panels?.[0]?.defaultSize.h ?? 680, 800) })
  const projectId = useStore(s => s.activeProjectId)
  const cwd = useStore(s => s.projects.find(p => p.id === projectId)?.path ?? '')
  const panel = plugin.panels?.find(p => p.id === panelId)

  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => {
      dialog.close()
      queueMicrotask(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) })
    }
  }, [returnFocus])

  return createPortal(
    <dialog ref={ref} className="mk-popup" aria-label={`${plugin.displayName}插件面板`}
      style={{ width: `min(${size.w}px, calc(100vw - 32px))`, height: `min(${size.h}px, calc(100vh - 32px))` }}
      onMouseDown={e => {
        if (e.target !== e.currentTarget) return
        const box = e.currentTarget.getBoundingClientRect()
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose()
      }}
      onKeyDown={e => e.stopPropagation()}
      onCancel={e => { e.preventDefault(); onClose() }}>
      <header className="mk-popup-head"><div><small>插件面板</small><h2>{plugin.displayName}{panel && (plugin.panels?.length ?? 0) > 1 ? ` · ${panel.title}` : ''}</h2></div><button type="button" className="mk-popup-close" aria-label="关闭插件面板" onClick={onClose}>×</button></header>
      {panel ? <div className="mk-popup-content"><PluginPanel key={`${plugin.id}:${panel.id}`} popup onPopupResize={(w,h) => setSize({w,h})} ctx={{ nodeId:'',frameId:'',projectId,cwd,props:{pluginId:plugin.id,panelId:panel.id} }} /></div>
        : <div className="mk-popup-select"><p>选择要打开的面板</p>{plugin.panels?.map(panel => <button key={panel.id} type="button" onClick={() => { setPanelId(panel.id); setSize({w:panel.defaultSize.w,h:panel.defaultSize.h}) }}>{panel.title}<span>打开 ›</span></button>)}</div>}
    </dialog>, document.body
  )
}
