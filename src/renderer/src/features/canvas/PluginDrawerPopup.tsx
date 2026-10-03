import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PluginInfo } from '../../../../shared/types'
import { PluginPanel } from '../plugins/PluginPanel'
import { userPanels } from '../../../../shared/pluginPanelSurface.ts'
import { initialPanelId } from './pluginDrawerGate.ts'
import { useStore } from '../../store'
import { useT } from '../../i18n.ts'

/** A drawer surface, not a canvas node. The existing plugin sandbox owns the iframe. */
export function PluginDrawerPopup({ plugin, onClose, returnFocus }: {
  plugin: PluginInfo
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement>
}): JSX.Element {
  const tr = useT()
  const ref = useRef<HTMLDialogElement>(null)
  // 隐藏面板（hidden:true，如发布台分屏头条）不给用户挑，也不参与「只有一个就直接开」
  const panels = userPanels(plugin.panels)
  const [panelId, setPanelId] = useState<string | null>(() => initialPanelId(plugin))
  const [size, setSize] = useState({ w: Math.min(panels[0]?.defaultSize.w ?? 900, 1100), h: Math.min(panels[0]?.defaultSize.h ?? 680, 800) })
  const projectId = useStore(s => s.activeProjectId)
  const cwd = useStore(s => s.projects.find(p => p.id === projectId)?.path ?? '')
  const panel = panels.find(p => p.id === panelId)

  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => {
      dialog.close()
      queueMicrotask(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) })
    }
  }, [returnFocus])

  return createPortal(
    <dialog ref={ref} className="mk-popup" aria-label={tr('panels.popup.aria', { name: plugin.displayName })}
      style={{ width: `min(${size.w}px, calc(100vw - 32px))`, height: `min(${size.h}px, calc(100vh - 32px))` }}
      onMouseDown={e => {
        if (e.target !== e.currentTarget) return
        const box = e.currentTarget.getBoundingClientRect()
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose()
      }}
      onKeyDown={e => e.stopPropagation()}
      onCancel={e => { e.preventDefault(); onClose() }}>
      <header className="mk-popup-head"><div><small>{tr('panels.popup.title')}</small><h2>{plugin.displayName}{panel && panels.length > 1 ? ` · ${panel.title}` : ''}</h2></div><button type="button" className="mk-popup-close" aria-label={tr('panels.popup.close')} onClick={onClose}>×</button></header>
      {panel ? <div className="mk-popup-content"><PluginPanel key={`${plugin.id}:${panel.id}`} popup onPopupResize={(w,h) => setSize({w,h})} ctx={{ nodeId:'',frameId:'',projectId,cwd,props:{pluginId:plugin.id,panelId:panel.id} }} /></div>
        : <div className="mk-popup-select"><p>{tr('panels.popup.pick')}</p>{panels.map(panel => <button key={panel.id} type="button" onClick={() => { setPanelId(panel.id); setSize({w:panel.defaultSize.w,h:panel.defaultSize.h}) }}>{panel.title}<span>{tr('panels.popup.open')}</span></button>)}</div>}
    </dialog>, document.body
  )
}
