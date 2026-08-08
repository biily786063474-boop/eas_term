// 拖拽类操作（画布平移/框选/画图形/拖模块/拖 Frame，甘特图取景框/绘图区拖拽）都靠
// window 的 'blur' 事件当场收尾：拖到一半窗口真的失焦（切到别的 app、⌘Tab……），
// 不这么做的话 mouseup 永远等不到，mousemove 监听会永久悬空在 document 上。
//
// 但 blur 不全是「真的失焦」。灵动岛跳转失败时的核实兜底（见 main/island.ts
// verifyRealActivation）会在第二次尝试时调 win.hide()+win.show()+webContents.focus()——
// 这一组合已经实测证实会在主窗口渲染层触发一次真实的 DOM blur，紧跟着一次 focus
// 把状态收回来。如果拖拽的 blur 收尾不分青红皂白照单全收，用户从灵动岛跳回来后
// 立刻开始的拖拽就会被这次内部抖动误伤打断（元素停在当前位置，或框选被清空）。
//
// 这里不去猜「这次 blur 是不是那个重试造成的」——不管源头是什么，只要 blur 后
// 很快又跟着一次 focus，就说明窗口本身没有真的交出焦点太久，按「抖动」处理，
// 拖拽原样继续（document 级监听不动，用户感觉不到任何中断）。真失焦时
// （切到别的 app 且没有很快切回来）等不到这次 focus，JITTER_MS 后照常收尾——
// 收尾本身只是内部状态清理，不是用户能看到的界面反馈，延迟这一点时间不影响体验。
//
// 用「等一个短窗口看 focus 追不追得上来」而不是去问主进程「这次 blur 是不是你造成的」
// （IPC 信号方案），是因为这样不用在 island.ts 和每一处拖拽之间建一条新的跨进程契约——
// 以后任何其他原因造成的类似瞬时抖动，这里也一并兜住，不用每次冒出新的抖动源
// 就再加一条专门的信号。
const JITTER_MS = 500

/** 挂一个「过滤过抖动」的 blur 监听：真失焦（且 JITTER_MS 内没有等到补上的 focus）
 *  才会调用 onRealBlur。返回值是唯一的拆除入口——原来 `window.removeEventListener
 *  ('blur', onUp)` 的地方换成调用它，会连带清掉可能还没触发的收尾计时器。 */
export function attachBlurGuard(onRealBlur: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const onFocus = (): void => {
    // 抖动：blur 后很快又 focus 回来了，取消这次收尾，拖拽当作没发生过中断
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const onBlur = (): void => {
    // 已经有一轮 blur 在等 focus 追上来了，重复的 blur 不重新起计时——
    // 不然新计时器会覆盖掉 timer 这个变量，旧计时器就没人能再 clearTimeout 它了：
    // 之后真等到 focus，onFocus 只清得掉最新这一个，那个悬空的旧计时器照样会在
    // JITTER_MS 后触发 onRealBlur，把已经继续的拖拽在没有征兆的情况下收尾掉。
    // 正常情况下 blur 不会连续触发两次（DOM 语义上失焦之间必有一次 focus），
    // 但保留这道防线不额外花什么代价。
    if (timer) return
    window.addEventListener('focus', onFocus)
    timer = setTimeout(() => {
      timer = null
      window.removeEventListener('focus', onFocus)
      onRealBlur()
    }, JITTER_MS)
  }
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    if (timer) clearTimeout(timer)
  }
}
