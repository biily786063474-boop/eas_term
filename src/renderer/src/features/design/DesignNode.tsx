// 设计模块（Step 3）：画布节点入口卡片，点「打开设计」全屏挂 UnifiedComposer（移植自 taptv）。
// 设计模式（Konva 画形状/文本/图片+图层）↔ 动效模式（关键帧/预设动效）双模式;
// 导出：设计→PNG/JPG,动效→WebM/MP4,统一落到 <项目>/demo/。UnifiedComposer 是 fixed 全屏覆盖层 → portal 到 body。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { DesignIcon } from '../../ui/Icons'
// 移植来的统一设计/动效编辑器（default export，index.jsx，allowJs）
import UnifiedComposer from './composer'
import './design.css'

// 节点持久化的 blob：新格式是 unified {v,mode,designState,motionState};旧格式只有 designState（objects[]）
export type SavedBlob = Record<string, unknown>

// 旧 designState（无 designState 键、直接是 objects 容器）→ 包成 unified；已是 unified 则原样
function toUnified(saved: SavedBlob | null): SavedBlob | null {
  if (!saved) return null
  return !('designState' in saved)
    ? { v: 1, mode: 'design', designState: saved, motionState: null }
    : saved
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
  savedState: SavedBlob | null
}): JSX.Element {
  const [editing, setEditing] = useState(false)

  // 全屏期间告诉画布让路。画布那几个 window 级键盘监听收不到「我被盖住了」这件事，
  // 不说一声的话，在设计模块里按 Delete 会删掉画布上的节点、按空格会切成画布平移、
  // 按 Esc 两边一起响应（设计模块自己也认 Esc）。判据放在 store 里的理由见 uiSlice。
  // cleanup 里无条件清掉 —— 组件被卸载（Frame 删了、切了视图）时 editing 还是 true，
  // 只在 setEditing(false) 那条路上清的话，标志会永远挂着，画布从此收不到键盘。
  const setFullscreenOverlay = useStore((s) => s.setFullscreenOverlay)
  useEffect(() => {
    if (!editing) return
    setFullscreenOverlay('design')
    return () => setFullscreenOverlay(null)
  }, [editing, setFullscreenOverlay])
  const [blob, setBlob] = useState<SavedBlob | null>(() => toUnified(savedState))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const setNodeComponentProps = useStore((s) => s.setNodeComponentProps)

  const designState = (blob?.designState ?? null) as { objects?: unknown[]; canvasWidth?: number; canvasHeight?: number } | null
  const objCount = Array.isArray(designState?.objects) ? designState!.objects!.length : 0
  const mode = (blob?.mode as string) ?? 'design'

  const flash = (ok: boolean, text: string): void => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4500)
  }

  // 扩展名：设计模式给 format(png/jpeg);动效模式不给 format,按 blob.type 推(mp4/webm)
  const extOf = (b: Blob, format?: string): string => {
    if (format) return format === 'jpeg' ? 'jpg' : format
    if (b.type.includes('mp4')) return 'mp4'
    if (b.type.includes('webm')) return 'webm'
    if (b.type.includes('png')) return 'png'
    if (b.type.includes('jpeg')) return 'jpg'
    return 'bin'
  }

  // composer 导出（设计 PNG/JPG · 动效 WebM/MP4）→ 落到项目 demo/
  const onExport = async (b: Blob, format?: string): Promise<void> => {
    try {
      const buf = await b.arrayBuffer()
      const name = `design-${Date.now()}.${extOf(b, format)}`
      const r = await window.api.design.exportToDemo(cwd, name, buf)
      if (r.ok) flash(true, `已导出 → demo/${name}`)
      else flash(false, r.error ?? '导出失败')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : String(e))
    }
  }

  // composer 自动保存 unified blob → 存回节点 component.props.unifiedState（随 canvas.json 持久化）
  const onSaveState = (state: SavedBlob): void => {
    setBlob(state)
    setNodeComponentProps(frameId, nodeId, { unifiedState: state })
  }

  return (
    <div className="design-node">
      <div className="design-card" onDoubleClick={() => setEditing(true)}>
        <DesignIcon size={30} />
        <div className="design-card-title">设计模块</div>
        <div className="design-card-sub">
          {objCount > 0
            ? `${objCount} 个元素 · ${mode === 'animate' ? '动效' : '设计'}模式`
            : '空设计 · 双击或点下方打开'}
        </div>
        <button className="design-btn primary" onClick={() => setEditing(true)}>
          打开设计
        </button>
      </div>
      {msg && <div className={`design-msg${msg.ok ? ' ok' : ' err'}`}>{msg.text}</div>}
      {editing &&
        createPortal(
          <UnifiedComposer
            nodeId={nodeId}
            savedState={blob}
            designInputs={[]}
            mediaInputs={[]}
            onExport={onExport}
            onSaveState={onSaveState}
            onClose={() => setEditing(false)}
          />,
          document.body
        )}
    </div>
  )
}
