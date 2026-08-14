// 「抽屉里的文件 → 画布上的自由节点」这条路，只有这一份实现。
//
// 原来它长在 CanvasWikiDrawer.tsx 里（知识库文件 → 只读预览节点）。Skill 面板要做同一件事
// （skill 文件 → 可编辑节点），照抄一份的话就会有两套「拖拽阈值 / 世界坐标反算 /
// .html 渲染还是源码」的逻辑，改一处忘一处是迟早的事，所以抽出来共用。
//
// 两边**唯一的差别**是落地节点可不可写，用参数区分，不要再分叉出第二份实现：
//   - 知识库：readOnly=true —— 内容离开知识库目录不该被顺手改掉（既有决定，保持不变）
//   - skill：readOnly=false + writeVia='skill' —— 拖出来就是为了改它
//     （writeVia 的存在理由见下面 openInCanvas 的注释）
import { useCallback, useState } from 'react'
import { useStore } from '../../store'
import { paneForFile, isHtmlPath } from './media'
import { HtmlOpenChoice } from './HtmlOpenChoice'
import type { PaneState } from '../../layout'

export interface OpenInCanvasOpts {
  /** 落地的节点是不是只读（CodeView 据此决定出不出「编辑」按钮） */
  readOnly?: boolean
  /** 可写节点的保存通道。'skill' = 走 skillLibrary:writeFile（它有自己的窄边界）。
   *  不设则走 fs:writeTextFile（过 fsGuard，只认项目根和知识库根）。 */
  writeVia?: 'skill'
}

/** 当前视口中心的世界坐标。双击/搜索命中这类「没有松手点」的动作落在这里。 */
export function viewportCenter(): { wx: number; wy: number } {
  const el = document.querySelector('.canvas-viewport') as HTMLElement | null
  const vp = useStore.getState().canvas.viewport
  const cw = el?.clientWidth ?? window.innerWidth
  const ch = el?.clientHeight ?? window.innerHeight
  return { wx: (cw / 2 - vp.x) / vp.scale, wy: (ch / 2 - vp.y) / vp.scale }
}

export function useOpenInCanvas(opts: OpenInCanvasOpts = {}): {
  openInCanvas: (path: string, wx: number, wy: number) => void
  /** 从抽屉里的文件树条目起手拖拽。5px 阈值内当普通点击（交给 onPlainClick） */
  startFileDrag: (path: string, e: React.MouseEvent, onPlainClick?: () => void) => void
  /** 「渲染还是源码」的选择浮层，调用方把它渲染出来即可（null 表示当前不需要） */
  htmlChoice: JSX.Element | null
} {
  const { readOnly, writeVia } = opts
  /** 拖 .html 进画布时的「渲染还是源码」选择 */
  const [htmlPick, setHtmlPick] = useState<{
    x: number
    y: number
    path: string
    place: (pane: PaneState) => void
  } | null>(null)

  // 文件 → 画布任意位置：统一走自由节点（不用 Frame，不判断落点在不在 Frame 上）。
  const openInCanvas = useCallback(
    (path: string, wx: number, wy: number): void => {
      const place = (pane: PaneState): void => {
        useStore.getState().addFreeFileNode(pane, wx, wy, { readOnly, writeVia })
      }
      // .html 两种看法都合理（渲染 / 源码），不替用户定。
      // 弹窗要屏幕坐标，而这里拿到的是世界坐标 —— 反算回去，
      // 这样拖拽（松手点）和双击/搜索（视口中心）两条路不用各写一套
      if (isHtmlPath(path)) {
        const el = document.querySelector('.canvas-viewport') as HTMLElement | null
        const r = el?.getBoundingClientRect()
        const vp = useStore.getState().canvas.viewport
        setHtmlPick({
          x: (r?.left ?? 0) + wx * vp.scale + vp.x,
          y: (r?.top ?? 0) + wy * vp.scale + vp.y,
          path,
          place
        })
        return
      }
      place(paneForFile(path))
    },
    [readOnly, writeVia]
  )

  // 拖文件树条目到画布任意位置（含 Frame 外）。5px 阈值内当普通点击处理，
  // 阈值外才是真拖拽——和 CanvasDrawer 里项目文件树的拖拽手感保持一致。
  const startFileDrag = useCallback(
    (path: string, e: React.MouseEvent, onPlainClick?: () => void): void => {
      if (e.button !== 0) return
      e.preventDefault()
      const start = { x: e.clientX, y: e.clientY, started: false }
      let ghost: HTMLDivElement | null = null
      const name = path.split('/').pop() ?? path
      const onMove = (ev: MouseEvent): void => {
        if (!start.started) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
          start.started = true
          ghost = document.createElement('div')
          ghost.className = 'canvas-drag-ghost'
          ghost.textContent = name
          document.body.appendChild(ghost)
        }
        if (ghost) {
          ghost.style.left = ev.clientX + 12 + 'px'
          ghost.style.top = ev.clientY + 10 + 'px'
        }
      }
      const onUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        ghost?.remove()
        if (!start.started) {
          onPlainClick?.() // 没挪动 = 普通点击
          return
        }
        const vpEl = document.querySelector('.canvas-viewport')
        if (!vpEl) return
        const r = vpEl.getBoundingClientRect()
        const vp = useStore.getState().canvas.viewport
        const wx = (ev.clientX - r.left - vp.x) / vp.scale
        const wy = (ev.clientY - r.top - vp.y) / vp.scale
        openInCanvas(path, wx - 90, wy - 15) // 偏移让节点头部大致居中在松手点（对齐 CanvasDrawer 的既有手感）
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [openInCanvas]
  )

  const htmlChoice = htmlPick ? (
    <HtmlOpenChoice
      x={htmlPick.x}
      y={htmlPick.y}
      fileName={htmlPick.path.split('/').pop() ?? ''}
      onPick={(as) => htmlPick.place(paneForFile(htmlPick.path, as))}
      onClose={() => setHtmlPick(null)}
    />
  ) : null

  return { openInCanvas, startFileDrag, htmlChoice }
}
