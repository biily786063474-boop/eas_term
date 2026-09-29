// 宿主文档里「最后一次指针位置」的单一追踪器（修复轮 3，2026-09-29）。
//
// 插件面板的滚轮 / 中键闸门要知道「指针是不是在这个面板里」。`:hover` 在 OOPIF 里恒为假；
// 指针进 iframe 后父文档也收不到任何 move（真机探针，见 panelPointerBridge.ts 的 pointerInNode）。
// 所以只记父文档**最后**看到的位置：document 捕获阶段的 pointermove + mousemove 刷新，
// window blur 与 document mouseleave / pointerleave（指针离开窗口）清空。
// 全局只挂一份，按引用计数随插件面板挂载 / 卸载装拆。

export type HostPointer = { clientX: number; clientY: number; time: number }

let last: HostPointer | null = null
let users = 0

const record = (e: MouseEvent): void => {
  last = { clientX: e.clientX, clientY: e.clientY, time: performance.now() }
}
const clear = (): void => {
  last = null
}

export function lastHostPointer(): HostPointer | null {
  return last
}

/** 挂上追踪器（引用计数），返回卸载函数。 */
export function attachHostPointerTracker(): () => void {
  if (users++ === 0) {
    document.addEventListener('pointermove', record, true)
    document.addEventListener('mousemove', record, true)
    document.addEventListener('mouseleave', clear)
    document.addEventListener('pointerleave', clear)
    // document 本身的 mouseleave 各内核不一定派发，根元素上的那份是可靠的
    document.documentElement.addEventListener('mouseleave', clear)
    window.addEventListener('blur', clear)
  }
  let done = false
  return () => {
    if (done) return
    done = true
    if (--users > 0) return
    document.removeEventListener('pointermove', record, true)
    document.removeEventListener('mousemove', record, true)
    document.removeEventListener('mouseleave', clear)
    document.removeEventListener('pointerleave', clear)
    document.documentElement.removeEventListener('mouseleave', clear)
    window.removeEventListener('blur', clear)
    last = null
  }
}
