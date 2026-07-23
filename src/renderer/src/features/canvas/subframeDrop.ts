import { useStore } from '../../store'

// 拖模块时判定「是否悬停在某子 Frame 上满 1 秒 → 把模块移入该子 Frame，并弹一下作反馈」。
// 用 elementsFromPoint 穿过被拖模块，找到其下方的子 Frame（parentId 有值、且非模块当前所在 Frame）。
const DWELL_MS = 1000
const POP_MS = 440

export function makeSubframeDrop(homeFrameId: string, nodeId: string): {
  done: boolean
  track: (clientX: number, clientY: number) => void
  end: () => void
} {
  let pendingEl: HTMLElement | null = null
  let timer: number | null = null
  let finished = false

  const clear = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    pendingEl?.classList.remove('cframe-drop-pending')
    pendingEl = null
  }

  return {
    get done(): boolean {
      return finished
    },
    track(clientX: number, clientY: number): void {
      if (finished) return
      const frames = useStore.getState().canvas.frames
      let targetEl: HTMLElement | null = null
      let targetFid = ''
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        const fe = (el as HTMLElement).closest?.('.cframe[data-fid]') as HTMLElement | null
        if (!fe) continue
        const fid = fe.dataset.fid ?? ''
        if (fid === homeFrameId) continue // 跳过模块自己所在 Frame，继续找底下的子 Frame
        const f = frames.find((x) => x.id === fid)
        if (f && f.parentId) {
          targetEl = fe
          targetFid = fid
          break
        }
      }
      if (!targetEl) {
        clear()
        return
      }
      if (targetEl === pendingEl) return // 已在对同一子 Frame 计时
      clear()
      pendingEl = targetEl
      targetEl.classList.add('cframe-drop-pending')
      timer = window.setTimeout(() => {
        useStore.getState().moveNodeToFrame(homeFrameId, nodeId, targetFid)
        const el = pendingEl
        el?.classList.remove('cframe-drop-pending')
        el?.classList.add('cframe-drop-pop') // 到 1s → 缩放弹一下反馈
        window.setTimeout(() => el?.classList.remove('cframe-drop-pop'), POP_MS)
        pendingEl = null
        timer = null
        finished = true
      }, DWELL_MS)
    },
    end(): void {
      clear()
    }
  }
}
