// 看板列的滚动接管 + 卡片折叠。
//
// 两件事，都必须绕开 React 直接改 DOM：滚动一秒能来几十次，
// 每次都过一遍 setState 的话，一列十几张卡片跟着重渲染，手感直接废掉。
//
// 一、**滚轮归看板，不归终端**
//     看板总览上没有终端，但全屏那一个仍然浮在 pane-layer 上；而且这条判据
//     以后加别的浮层也用得着：判的是**终端有没有键盘焦点** ——
//     真在用它才归它翻 scrollback，只是指针悬着就归列。
//
// 二、**滚上去的卡片折叠成一摞**
//     算法取自 React Bits 的 ScrollStack（钉住 + 逐级缩小 + 层叠偏移），
//     但没用那个组件：它是 Tailwind 写的、平滑滚动依赖 Lenis，本项目两样都没有，
//     为一个折叠效果装一个滚动库不值当 —— 原生 scroll + transform 就够。
import { useEffect } from 'react'

/** 折叠区最多留几张。再多就纯粹是糊在一起的色块，还白白占着渲染 */
const MAX_STACK = 3
/** 每张往下错开多少，露出一点边表示「下面还压着」 */
const STACK_GAP = 9
/** 卡片顶越过列顶多少像素后收缩到底 */
const FOLD_DIST = 130
const MIN_SCALE = 0.87

/** 把一列里的卡片按当前滚动位置摆好。直接写 style，不经过 React */
function foldColumn(list: HTMLElement): void {
  const cards = Array.from(list.querySelectorAll<HTMLElement>('.board-card'))
  const s = list.scrollTop
  // **先把所有 offsetTop 读完再动手写 style。** 读几何属性会强制浏览器结算布局，
  // 读一个写一个的话每张卡片都可能触发一次 reflow（layout thrashing），
  // 一列十几张、每帧一遍，滚起来就是一顿一顿的。
  // offsetTop 相对 .board-list（它是 position:relative 的容器）
  const tops = cards.map((c) => c.offsetTop)
  // 层次必须从「最上面那张」倒着算：一摞里最新滚上去的在最前面（最清晰、z 最高），
  // 底下的越老越淡。顺着数正好反过来 —— 压在最底下的最清晰，刚滚上去的直接消失。
  let total = 0
  for (const t of tops) if (t - s < 0) total++

  let idx = 0
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const vy = tops[i] - s
    if (vy >= 0) {
      // 还没到顶：保持原样。**必须显式清掉**，否则从折叠态滚回来时样式留在上面
      if (card.dataset.fold) {
        delete card.dataset.fold
        card.style.transform = ''
        card.style.filter = ''
        card.style.opacity = ''
        card.style.zIndex = ''
        card.style.pointerEvents = ''
      }
      continue
    }
    const over = -vy
    const t = Math.min(1, over / FOLD_DIST)
    /** 0 = 这摞里最上面那张（最后滚上去的）。往下越老越大 */
    const fromTop = total - 1 - idx
    idx++
    // 只留最上面几张。再往下纯粹是糊在一起的色块，还白白占着渲染
    const dead = fromTop >= MAX_STACK
    // 老的往上错一点，把顶边露出来 —— 一摞纸的样子
    const y = over - fromTop * STACK_GAP

    card.dataset.fold = '1'
    card.style.transform = `translate3d(0, ${Math.round(y)}px, 0) scale(${(1 - t * (1 - MIN_SCALE)).toFixed(3)})`
    // **层次用 brightness 不用 opacity**：opacity 会把卡片连同它的背景一起变透，
    // 一摞叠起来下面几张的字全透上来糊成一团。brightness 只改颜色不改 alpha，
    // 背景仍然是实的，压住的部分干干净净。只有「已经该消失」的那几张才用 opacity。
    card.style.filter = dead ? '' : `brightness(${(1 - fromTop * 0.26).toFixed(2)})`
    card.style.opacity = dead ? '0' : ''
    // 最上面那张 z 最高，压住底下的
    card.style.zIndex = String(100 - fromTop)
    // 被压住的那几张不接鼠标：它们缩过、还盖着别的卡片，点中十有八九是误触
    card.style.pointerEvents = 'none'
  }
}

export function useBoardScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const board = document.querySelector<HTMLElement>('.board')
    if (!board) return

    let raf = 0
    const foldAll = (): void => {
      raf = 0
      board.querySelectorAll<HTMLElement>('.board-list').forEach(foldColumn)
    }
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(foldAll)
    }

    /** 指针底下那一列的滚动容器。终端是绝对定位浮在 pane-layer 上的，
     *  从 e.target 往上找永远找不到列 —— 只能按坐标穿透着找。 */
    const listUnder = (x: number, y: number): HTMLElement | null => {
      for (const el of document.elementsFromPoint(x, y)) {
        const list = (el as HTMLElement).closest?.('.board-list')
        if (list) return list as HTMLElement
      }
      return null
    }

    const onWheel = (e: WheelEvent): void => {
      const t = e.target as HTMLElement | null
      const pane = t?.closest?.('.pane')
      // 终端拿着键盘焦点 = 人真在用它，滚轮归它翻 scrollback。
      // 只是指针悬在上面（没点过）就归列 —— 这是这个函数存在的全部理由
      if (pane && pane.contains(document.activeElement)) return
      const list = listUnder(e.clientX, e.clientY)
      if (!list) return
      // 已经到顶还往上滚 / 到底还往下滚：放行，让外层去处理（比如横向滚整个看板）
      const atTop = list.scrollTop <= 0 && e.deltaY < 0
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0
      if (atTop || atEnd) return
      e.preventDefault()
      e.stopPropagation()
      list.scrollTop += e.deltaY
    }

    // **挂 document，不能挂 .board**：终端是绝对定位浮在 pane-layer 上的，
    // 和看板是两棵独立的子树 —— 指针停在终端上时，事件冒泡路径压根不经过 .board，
    // 挂在那儿的监听一次都收不到（实测滚 8 下列纹丝不动）。
    // capture:true 同样是关键：xterm 自己也在捕获阶段听滚轮，不抢在它前面就轮不到我们。
    document.addEventListener('wheel', onWheel, { capture: true, passive: false })
    board.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    // 卡片增删（拖拽换列、开关终端）后位置全变了，得重排一次
    const mo = new MutationObserver(schedule)
    mo.observe(board, { childList: true, subtree: true })
    schedule()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
      board.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      mo.disconnect()
      // 卸载时把样式还回去，免得切走再切回来卡片还挂着上次的 transform
      board.querySelectorAll<HTMLElement>('.board-card').forEach((c) => {
        delete c.dataset.fold
        c.style.transform = ''
        c.style.filter = ''
        c.style.opacity = ''
        c.style.zIndex = ''
        c.style.pointerEvents = ''
      })
    }
  }, [active])
}
