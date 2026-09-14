// 「定位」的副作用部分：关掉设置、切到画布、把视口挪过去并选中。纯查找在 runtimeLocate.ts。
import { useStore } from '../../store'
import { findServiceNode } from './runtimeLocate'

/** 能不能定位（给按钮置灰用） */
export function canLocateService(serviceId: string): boolean {
  const s = useStore.getState()
  return findServiceNode(serviceId, s.tabs, s.canvas.frames) !== null
}

/** 返回是否成功。设置面板监听 eas:close-settings 自己收起。 */
export function locateService(serviceId: string): boolean {
  const s = useStore.getState()
  const hit = findServiceNode(serviceId, s.tabs, s.canvas.frames)
  if (!hit) return false
  window.dispatchEvent(new CustomEvent('eas:close-settings'))
  if (s.viewMode !== 'canvas') s.setViewMode('canvas')
  useStore.getState().focusCanvasNode(hit.frameId, hit.nodeId)
  return true
}
