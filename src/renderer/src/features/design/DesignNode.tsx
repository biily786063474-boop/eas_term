// 设计模块（Step 2）：画布节点是入口卡片，点「打开设计」全屏挂 Konva 设计画布（DesignerView，
// 移植自 taptv）。用户画形状/文本/图片 + 图层，导出 PNG 落到 <项目>/demo/，设计状态存回节点持久化。
// DesignerView 是 position:fixed 全屏覆盖层 → 必须 portal 到 body，否则被画布 transform 困住/错位。
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { DesignIcon } from '../../ui/Icons'
// 移植来的 Konva 设计器（default export，.jsx，allowJs）
import DesignerView from './composer/designer/DesignerView'
import './design.css'

export interface DesignState {
  objects?: unknown[]
  canvasWidth?: number
  canvasHeight?: number
  [k: string]: unknown
}

export function DesignNode({
  cwd,
  frameId,
  nodeId,
  savedState
}: {
  cwd: string
  frameId: string
  nodeId: string
  savedState: DesignState | null
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [design, setDesign] = useState<DesignState | null>(savedState ?? null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const setNodeComponentProps = useStore((s) => s.setNodeComponentProps)

  const objCount = Array.isArray(design?.objects) ? design!.objects!.length : 0

  const flash = (ok: boolean, text: string): void => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  // designer 顶栏「导出」→ ExportDialog → 这里拿到 PNG/JPG Blob → 落盘到项目 demo/
  const onExport = async (blob: Blob, format: string): Promise<void> => {
    try {
      const buf = await blob.arrayBuffer()
      const name = `design-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`
      const r = await window.api.design.exportToDemo(cwd, name, buf)
      if (r.ok) flash(true, `已导出 → demo/${name}`)
      else flash(false, r.error ?? '导出失败')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : String(e))
    }
  }

  // designer 自动保存 → 存回节点 component.props.designState（随 canvas.json 持久化）
  const onSaveState = (state: DesignState): void => {
    setDesign(state)
    setNodeComponentProps(frameId, nodeId, { designState: state })
  }

  return (
    <div className="design-node">
      <div className="design-card" onDoubleClick={() => setEditing(true)}>
        <DesignIcon size={30} />
        <div className="design-card-title">设计模块</div>
        <div className="design-card-sub">
          {objCount > 0 ? `${objCount} 个元素 · ${design?.canvasWidth ?? 1920}×${design?.canvasHeight ?? 1080}` : '空设计 · 双击或点下方打开'}
        </div>
        <button className="design-btn primary" onClick={() => setEditing(true)}>
          打开设计
        </button>
      </div>
      {msg && <div className={`design-msg${msg.ok ? ' ok' : ' err'}`}>{msg.text}</div>}
      {editing &&
        createPortal(
          <DesignerView
            nodeId={nodeId}
            savedState={design}
            mediaInputs={[]}
            onExport={onExport}
            onSaveState={onSaveState}
            onClose={() => setEditing(false)}
            topbarCenter={null}
          />,
          document.body
        )}
    </div>
  )
}
