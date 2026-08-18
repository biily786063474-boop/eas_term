// 「往输入框里塞图」这件事的共用逻辑：粘贴 / 拖入 / 把画布快照带进来。
//
// 抽出来是因为终端输入框和 AI 对话框要**完全一致**（用户明确要求）。
// 两边各写一份的话，迟早会分叉成「终端支持拖入、对话框只支持粘贴」这种
// 说不清的差别——而这几条规则每一条背后都有踩过的坑：
//
//   · 拖进来的文件**原地引用**，不复制一份，删缩略图时也绝不动人家的文件；
//     剪贴板里的是裸位图、没有路径，只能先落盘，那份才归我们删。
//   · 缩略图不能用 URL.createObjectURL —— 页面是 file:// 加载的，blob URL 的
//     origin 是 null，<img> 加载会静默失败（complete=true 但 naturalWidth=0，
//     看着就是一块空白）。只能缩小后转 data URL。
//   · 关掉面板时把「还没发出去」的粘贴图删掉，已经发出去的不能删（agent 还要读）。
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { track } from '../notify/track'

const THUMB_PX = 96

/** 缩成小图再转 data URL（理由见文件头） */
async function thumbnail(f: File): Promise<string> {
  const bmp = await createImageBitmap(f)
  const s = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * s))
  c.height = Math.max(1, Math.round(bmp.height * s))
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/png')
}

export interface PastedImg {
  /** 磁盘上的绝对路径——发出去的就是它 */
  path: string
  /** 缩略图（data URL） */
  url: string
  /** true = 用户从访达拖进来的，原地引用，删缩略图时不许动人家的文件 */
  external: boolean
  name: string
}

export interface PastedImages {
  imgs: PastedImg[]
  /** 收下一批文件，非图片的自动跳过 */
  takeFiles: (files: File[]) => Promise<void>
  /** 从框里叉掉一张 */
  dropImg: (im: PastedImg) => void
  /** 把最近一次画布快照带进输入框（「拍照」那条路） */
  takeSnapshotIn: () => Promise<void>
  /** 发送后清空（**不删文件**——已经发出去了，agent 还要读） */
  clearImgs: () => void
  /** 拼在文字前面的路径串，没有图片时是空串。
   *  路径排在文字前面：agent 先看到「有图」，再读你要它干什么。
   *  带空格的路径要加引号，否则会被读成两个文件。 */
  pathPrefix: () => string
  /** 一闪而过的错误提示（读不出图 / 存不下来） */
  err: string | null
}

export function usePastedImages(): PastedImages {
  const [imgs, setImgs] = useState<PastedImg[]>([])
  const [err, setErr] = useState<string | null>(null)
  const lastSnapshot = useStore((s) => s.lastSnapshot)
  const setLastSnapshot = useStore((s) => s.setLastSnapshot)

  // 卸载时清掉「还没发出去」的粘贴图。用 ref 是因为清理函数只在卸载时跑一次，
  // 闭包里的 imgs 会停在初值。
  const imgsRef = useRef<PastedImg[]>([])
  imgsRef.current = imgs
  useEffect(
    () => () => {
      for (const im of imgsRef.current) {
        if (!im.external) void window.api.pasteImage.remove(im.path)
      }
    },
    []
  )

  const flashErr = (m: string): void => {
    setErr(m)
    window.setTimeout(() => setErr(null), 3200)
  }

  const takeFiles = async (files: File[]): Promise<void> => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      track('image')
      let url: string
      try {
        url = await thumbnail(f)
      } catch {
        flashErr(`「${f.name || '这张图'}」读不出来`)
        continue
      }
      // 已经在磁盘上（从访达拖进来的）→ 直接引用，不再复制一份
      const disk = window.api.pasteImage.pathFor(f)
      if (disk) {
        setImgs((v) => [...v, { path: disk, url, external: true, name: f.name }])
        continue
      }
      const bytes = new Uint8Array(await f.arrayBuffer())
      const ext = (f.type.split('/')[1] || 'png').toLowerCase()
      const r = await window.api.pasteImage.save(bytes, ext)
      if (r.ok && r.path) {
        setImgs((v) => [...v, { path: r.path!, url, external: false, name: f.name || '粘贴的图片' }])
      } else {
        flashErr(r.error ?? '这张图存不下来')
      }
    }
  }

  const dropImg = (im: PastedImg): void => {
    if (!im.external) void window.api.pasteImage.remove(im.path)
    setImgs((v) => v.filter((x) => x !== im))
  }

  const takeSnapshotIn = async (): Promise<void> => {
    if (!lastSnapshot) return
    // external:true —— 文件在项目目录里、不归输入框管，松开缩略图时绝不能删它
    const url = await window.api.fs.readImageFile(lastSnapshot.path)
    setImgs((prev) => [
      ...prev,
      {
        path: lastSnapshot.path,
        url: url.ok ? url.dataUrl : '',
        external: true,
        name: lastSnapshot.path.split('/').pop() ?? 'snapshot.png'
      }
    ])
    setLastSnapshot(null) // 已经带进去了，不用再浮着
  }

  const clearImgs = (): void => setImgs([])

  const pathPrefix = (): string =>
    imgs.map((i) => (/\s/.test(i.path) ? `"${i.path}"` : i.path)).join(' ')

  return { imgs, takeFiles, dropImg, takeSnapshotIn, clearImgs, pathPrefix, err }
}
