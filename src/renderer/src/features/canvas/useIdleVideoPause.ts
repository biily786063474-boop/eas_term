import { useEffect, useRef, type RefObject } from 'react'

/** 画布上的视频节点：**用户去看别处的时候就暂停**。
 *
 *  为什么需要：画布上的 `<video>` 一旦播起来就永远不停 —— 你点去另一个模块、
 *  或者把别的节点最大化（这个节点被 `display:none` 藏起来），它还在后台解码。
 *  几个视频节点同时挂着，风扇就起来了。而这段时间画面根本没人在看。
 *
 *  **只 pause，不动 src、不回到开头**：用户点回来要能接着看。
 *  真想连解码器一起释放得把 src 摘掉，但那样播放位置就丢了，代价大于收益。
 *
 *  不用管「切出画布」那条：切视图时 CanvasStage 整个卸载，`<video>` 跟着没了，
 *  浏览器自然停止解码，这里再补一层是多余的。
 *
 *  ---
 *
 *  判据是**两条并联**，缺一条就漏：
 *
 *  1. `active`（被选中且没被别人最大化盖住）—— 管得住画布自己那套选中。
 *  2. **发生在本节点之外的任意一次 pointerdown** —— 管得住选中体系够不到的地方。
 *
 *  第 2 条不是保险，是必需的：2026-08-11 实测，只用第 1 条时**点终端不会暂停**。
 *  因为画布上的终端是 PaneLayer 渲染的、悬在画布之上的另一层 DOM，
 *  点它根本不走 `selectElement`，文件节点的 `sel` 类原样留着 —— 于是「用户明明
 *  已经在敲终端了，旁边的视频还在放」。
 *
 *  已知盖不到的一处：画布上的网页节点是 `<webview>`（独立渲染进程），
 *  点它不会在宿主页面产生 pointerdown。那种情况要等选中态变化才停。 */
export function useIdleVideoPause(active: boolean): RefObject<HTMLVideoElement> {
  // 用 useRef<T>(null) 而不是 useRef<T|null>(null)：前者才是 React 的 RefObject<T>，
  // 能直接当 JSX 的 ref 用；后者是 MutableRefObject<T|null>，类型对不上
  const ref = useRef<HTMLVideoElement>(null)

  const pause = (): void => {
    const v = ref.current
    // 已经是暂停态就别再调一次 —— pause() 会触发 pause 事件，
    // 无谓地惊动 controls 的 UI 状态
    if (v && !v.paused) v.pause()
  }

  // ① 选中态：被别的节点最大化盖住、框选被清空等
  useEffect(() => {
    if (!active) pause()
    // pause 每次渲染都是新闭包但只读 ref，拿哪一次都一样
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // ② 点到了本节点外面
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const v = ref.current
      if (!v || v.paused) return // 没在播就没什么可停的，也省掉下面的 DOM 查询
      // 点在自己这个模块里（包括视频自己的播放控件）不算「去看别处」。
      // 播放控件在 shadow DOM 里，composedPath() 之外的 target 会被规范化成
      // 宿主 <video> 元素，所以 contains 判得到。
      const node = v.closest('.cfile-node')
      if (node && node.contains(e.target as Node)) return
      v.pause()
    }
    // 捕获阶段：别人 stopPropagation 也拦不住我们（画布节点自己就在冒泡阶段拦事件）
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  return ref
}
