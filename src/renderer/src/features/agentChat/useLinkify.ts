// 把已渲染的 markdown DOM 里的裸网址 / 本地路径变成可 Ctrl+点击的目标。
//
// ── 为什么是 DOM 后处理，不是渲染前替换 ────────────────────────────────
// 消息正文走的是共用的 renderMarkdown + dangerouslySetInnerHTML。在字符串阶段
// 插 <a> 标签会有两个麻烦：一是要处理 HTML 转义与已有标签的嵌套（把 <code> 里的
// 路径也包进去就乱了），二是那个渲染器是编辑器和对话共用的，改它会波及文档预览。
// 后处理只走**文本节点**，天然不会碰到已有的 <a>、<code>、属性值。
//
// ── 为什么必须 Ctrl/Cmd 点击 ──────────────────────────────────────────
// 对话正文是要被选中复制的（用户明确要求过「文字可选中可复制」）。裸点击就跳转
// 会让划词选择变成误触发，比不能点更烦人。
import { useEffect } from 'react'

import { splitByLinks, isFollowClick, type LinkHit } from './linkify.ts'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'

/**
 * 打开一个网址。**优先落在同一个 Frame 的内嵌浏览器里**，实在没有画布 Frame 才
 * 回退系统浏览器 —— 画布上本来就有网页预览节点，把人赶去外部浏览器等于让他离开工作台。
 *
 * 查找逻辑与 TerminalView 里「终端点链接」那段**逐条对齐**（先按 leafId 找自己所在的
 * Frame，退而求其次找同项目的顶层 Frame，再退到任意顶层 Frame）。两处行为必须一致：
 * 同一个用户在终端里点和在对话里点，落点不该不一样。
 */
function openUrl(url: string, leafId?: string): void {
  const st = useStore.getState()
  let frame = leafId ? st.canvas.frames.find((f) => f.nodes.some((n) => n.leafId === leafId)) : undefined
  if (!frame) {
    const projectId = leafId
      ? st.tabs.find((t) => collectLeaves(t.root).some((l) => l.id === leafId))?.projectId
      : st.activeProjectId
    frame =
      st.canvas.frames.find((f) => !f.parentId && f.projectId === projectId) ??
      st.canvas.frames.find((f) => !f.parentId)
  }
  if (!frame) {
    void window.api.shell.openExternal(url)
    return
  }
  if (st.viewMode !== 'canvas') st.setViewMode('canvas')
  st.addWebNode(frame.id, url)
}

/** 不进去找链接的容器：代码块里的路径由「复制」按钮负责，行内代码同理。 */
const SKIP = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA'])

function decorate(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p = n.parentElement
      while (p && p !== root) {
        if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT
        p = p.parentElement
      }
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text)

  for (const node of targets) {
    const text = node.nodeValue ?? ''
    const parts = splitByLinks(text)
    if (parts.length === 1 && !parts[0].hit) continue // 没命中，原样不动
    const frag = document.createDocumentFragment()
    for (const p of parts) {
      if (!p.hit) {
        frag.appendChild(document.createTextNode(p.text))
        continue
      }
      const a = document.createElement('span')
      a.className = `ac-link ac-link-${p.hit.kind}`
      a.textContent = p.text
      a.dataset.kind = p.hit.kind
      a.dataset.target = p.hit.target
      if (p.hit.line) a.dataset.line = String(p.hit.line)
      a.title = p.hit.kind === 'url' ? '⌘/Ctrl+点击 在浏览器打开' : '⌘/Ctrl+点击 在访达中显示'
      frag.appendChild(a)
    }
    node.parentNode?.replaceChild(frag, node)
  }
}

/**
 * 给一个容器挂上链接识别与点击处理。
 *
 * @param ref 容器（消息正文那个 div）
 * @param dep 内容变化的依据 —— 流式输出时正文每帧都在变，必须跟着重做
 */
export function useLinkify(ref: React.RefObject<HTMLElement>, dep: unknown, leafId?: string): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    decorate(el)
  }, [ref, dep])

  // 按住 ⌘/Ctrl 时整段正文切到「可点」外观。**一次全亮**，不是划过哪个亮哪个 ——
  // 后者要一个个试才知道哪些能点。松开或窗口失焦立刻还原（失焦那条不能省：
  // 切走时按键抬起事件收不到，class 会永久挂着）。
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = (on: boolean): void => {
      el.classList.toggle('ac-mod-down', on)
    }
    const down = (e: KeyboardEvent): void => sync(e.ctrlKey || e.metaKey)
    const up = (e: KeyboardEvent): void => sync(e.ctrlKey || e.metaKey)
    const off = (): void => sync(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onClick = (e: MouseEvent): void => {
      const t = (e.target as HTMLElement)?.closest?.('.ac-link') as HTMLElement | null
      if (!t) return
      // 裸点击留给选中文字 —— 只有 Ctrl/Cmd 才跳转
      if (!isFollowClick(e)) return
      e.preventDefault()
      e.stopPropagation()
      const kind = t.dataset.kind
      const target = t.dataset.target
      if (!target) return
      if (kind === 'url') openUrl(target, leafId)
      // 本地路径：在访达里显示。**不直接开文件** —— 我们不知道它该用什么打开，
      // 而访达里定位到它，用户接下来想怎么处理都行
      else void window.api.fs.showInFolder(target)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [ref, leafId])
}

export type { LinkHit }
