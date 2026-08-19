// 抽屉里点开一个文件的默认看法：**灯箱**，不是往画布上落一个节点。
//
// 为什么不落画布：抽屉里的文件（skill 的 SKILL.md、references/*.md）多数是「看一眼、
// 顺手改一句」，落成画布节点等于每看一次就在画布上留一件东西，用户回头还得自己收。
// 灯箱看完即走，画布保持干净。真要留在画布上的，走标题栏的「放到画布」或者直接拖 ——
// 那是显式动作，不该是默认动作。
//
// 内容区整个交给 CodeView：markdown 排版 / 源码切换 / 编辑 / 保存都是它已经有的能力，
// 这里不重做一份，只负责「壳」。
//
// 视觉与进退场**照抄 CanvasTodoBoard 里的 TodoLightbox**（同一个 app 里两个灯箱
// 长得不一样很别扭）。只有尺寸不同：那个装一条待办，这个要装一篇 markdown。
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CodeView } from '../editor/CodeView'
import { CanvasIcon, CloseIcon } from '../../ui/Icons'

/** 退场动效时长，要跟 canvas.css 里 .flb 的 transition 对上 */
const EXIT_MS = 200
/** 刚弹出来的这段时间里，点遮罩不关闭。
 *  单击已经能开灯箱了，而用户手上仍是「双击打开文件」的老习惯 —— 第二下会落在
 *  灯箱外的遮罩上（文件树在灯箱右侧），于是开了又被自己关掉。CDP 实测复现。
 *  比双击间隔（系统默认 500ms 上限，实际手速多在 200ms 内）留一点余量。 */
const GUARD_MS = 350

export function FileLightbox({
  filePath,
  onClose,
  saveVia,
  onSendToCanvas
}: {
  filePath: string
  onClose: () => void
  /** 传给 CodeView 的保存通道（skill 面板走 skillLibrary:writeFile 那条窄口子） */
  saveVia?: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>
  /** 出「放到画布」按钮。不传就不出这个按钮 */
  onSendToCanvas?: (filePath: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const closingRef = useRef(false)
  const bornRef = useRef(0)
  if (!bornRef.current) bornRef.current = performance.now()
  // 关闭要读 dirty，而 Esc 监听只想挂一次 —— 用 ref 取当前值，
  // 别把 dirty 塞进依赖里反复装卸监听。
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // 挂载后下一帧才加 .open —— 隔一帧才有动效，理由同 TodoLightbox
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const close = useCallback((): void => {
    if (closingRef.current) return
    // 改了没保存就点掉 = 白改。不做花哨的挽留，问一句就够。
    if (dirtyRef.current && !window.confirm('有未保存的修改，确定关闭吗？')) return
    closingRef.current = true
    setOpen(false)
    window.setTimeout(onClose, EXIT_MS)
  }, [onClose])

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // CodeView 的右键菜单也吃 Esc，但它挂在 capture 阶段、先跑一步；
      // 走到这里说明那边没消费，这一下就是冲着灯箱来的。
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [close])

  const name = filePath.split(/[\\/]/).pop() ?? filePath

  // 遮罩点击专用：进场保护期内当作双击的余波，忽略
  const closeFromMask = (): void => {
    if (performance.now() - bornRef.current < GUARD_MS) return
    close()
  }

  return createPortal(
    <div className={`flb-overlay${open ? ' open' : ''}`} onMouseDown={closeFromMask}>
      <div
        className="flb"
        role="dialog"
        aria-modal="true"
        // 面板内部的点击不该关掉灯箱（选中文字时鼠标常会松在遮罩上）
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flb-head">
          <span className="flb-name" title={filePath}>
            {name}
          </span>
          {dirty && <span className="flb-dirty">未保存</span>}
          {!!onSendToCanvas && (
            <button
              className="flb-x"
              data-tip="在画布上开一个节点"
              onClick={() => {
                onSendToCanvas(filePath)
                close()
              }}
            >
              <CanvasIcon size={13} />
            </button>
          )}
          <button className="flb-x" data-tip="关闭 (Esc)" onClick={close}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="flb-body">
          <CodeView filePath={filePath} saveVia={saveVia} onDirtyChange={setDirty} />
        </div>
      </div>
    </div>,
    document.body
  )
}
