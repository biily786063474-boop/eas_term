// 终端底部的文字输入框。
//
// 存在的理由是三件在 xterm 里很别扭的事：
//   1. 中文输入法的候选框在 xterm 里会错位（xterm 自己管光标，IME 定位不到）
//   2. 长提示词写到一半想改前面，终端里只能一路退格
//   3. 粘贴多行文本会被逐行当成命令执行——写给 agent 的多段话尤其容易踩
//
// 它不替代终端输入，只是"先写好再发"的暂存区。写完的内容原样写进 pty，
// 和你在终端里手打没有区别。
//
// 麦克风也在这一行里：语音定稿先落进这个框，说错了能改完再发。
// （原先它绝对定位在面板右下角，输入框一加上来两者就叠在了一起。）
//
// 图片：粘贴或拖进来，先在框上方排成缩略图，⌘↵ 时把**文件路径**连同文字一起发出去
// （agent 认的是本地路径）。为什么不沿用剪贴板那条老路：它只撑得住一张图，
// 而且你粘完图又复制了别的东西，发送时读到的就是错的。
import { useEffect, useRef, useState } from 'react'
import { VoiceButton } from '../voice/VoiceButton'

/** 输入框最多长到几行，超过就内部滚动。再高会把终端可视区挤没 */
const MAX_ROWS = 4
const LINE_H = 19

/** 缩略图边长。只是给人扫一眼确认「贴对了图没有」，不需要原图那么大 */
const THUMB_PX = 96

/** 缩成小图再转 data URL。
 *
 *  **不能用 URL.createObjectURL**：这个页面是 file:// 加载的，blob URL 的 origin 是 null，
 *  <img> 加载它会静默失败（complete=true 但 naturalWidth=0，看着就是一块空白）。
 *  顺带缩到 96px，原图直接转 base64 的话一张几 MB 的截图会在内存里躺一份两倍大的副本。 */
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

interface PastedImg {
  /** 磁盘上的绝对路径——发出去的就是它 */
  path: string
  /** 缩略图（data URL） */
  url: string
  /** true = 用户从访达拖进来的，原地引用，删缩略图时不许动人家的文件 */
  external: boolean
  name: string
}

export function TerminalInput({
  ptyId,
  onFocusTerm
}: {
  ptyId: string
  /** 把键盘焦点还给终端（Esc 时用） */
  onFocusTerm: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [flash, setFlash] = useState(false)
  const [imgs, setImgs] = useState<PastedImg[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  /** 上一条发出去的内容，空输入时按 ↑ 取回 */
  const lastRef = useRef('')

  /** 关终端时把「还没发出去」的粘贴图删掉。发出去的不能删——agent 还要读。
   *  用 ref 是因为清理函数只在卸载时跑一次，闭包里的 imgs 会是初值。 */
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

  /** 收下一批图片。拖进来的本来就在磁盘上，直接引用不再复制一份；
   *  剪贴板里的是裸位图，没有路径，只能先落盘。 */
  const takeFiles = async (files: File[]): Promise<void> => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      let url: string
      try {
        url = await thumbnail(f)
      } catch {
        flashErr(`「${f.name || '这张图'}」读不出来`)
        continue
      }
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

  /** 从框里叉掉一张。我们自己存的当场删，别人的文件只松手不动它 */
  const dropImg = (im: PastedImg): void => {
    if (!im.external) void window.api.pasteImage.remove(im.path)
    setImgs((v) => v.filter((x) => x !== im))
  }

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, LINE_H * MAX_ROWS) + 'px'
  }

  /** 送进 pty。withReturn=false 时只填不发，光标停在那儿等你自己按回车 */
  const send = (withReturn: boolean): void => {
    const text = value.trim()
    if (!text && !imgs.length) return
    lastRef.current = text
    // 图片路径排在文字前面：agent 先看到「有图」，再读你要它干什么。
    // 带空格的路径要加引号，否则会被读成两个文件。
    const paths = imgs.map((i) => (/\s/.test(i.path) ? `"${i.path}"` : i.path)).join(' ')
    const payload = paths ? (text ? `${paths} ${text}` : paths) : text
    window.api.pty.write(ptyId, withReturn ? payload + '\r' : payload)
    // 只松开缩略图，**不删文件**——agent 还没读呢（见 pasteImages.ts 的 24 小时策略）
    setImgs([])
    setValue('')
    const el = taRef.current
    if (el) {
      el.style.height = 'auto'
      // 发完把焦点留在输入框：连着写第二条是常态，每次都要重新点一下很烦
      el.focus()
    }
    setFlash(true)
    window.setTimeout(() => setFlash(false), 340)
  }

  /** 语音定稿落进框里。连着说几句会一路追加，等你 ⌘↵ 才发出去 */
  const appendVoice = (text: string): void => {
    setValue((prev) => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + text)
    // setValue 是异步的，得等这一帧渲染完再量高度，否则量到的是上一版内容
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el) autoGrow(el)
    })
  }

  return (
    <div
      className={`term-input${flash ? ' flash' : ''}${dragOver ? ' dragover' : ''}`}
      onDragOver={(e) => {
        // 只认文件拖拽。终端里拖选文字也会冒到这儿，不拦掉的话整个框会一直亮着
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        // 进入子元素也会触发 dragleave，用坐标判断是不是真的离开了这个框
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragOver(false)
        void takeFiles([...e.dataTransfer.files])
      }}
    >
      {err && <div className="term-input-err">{err}</div>}
      {imgs.length > 0 && (
        <div className="term-input-imgs">
          {imgs.map((im) => (
            <div className="tii" key={im.path} data-tip={im.path}>
              <img src={im.url} alt={im.name} />
              <button
                className="tii-x"
                aria-label="移除这张图"
                onMouseDown={(e) => {
                  e.preventDefault()
                  dropImg(im)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="term-input-row">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder="写点什么…（⌘↵ 发送，可粘贴/拖入图片）"
          spellCheck={false}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (!files.length) return // 纯文本粘贴走默认行为
            e.preventDefault()
            void takeFiles(files)
          }}
          onChange={(e) => {
            setValue(e.target.value)
            autoGrow(e.target)
          }}
          onKeyDown={(e) => {
            // ⌘↵ / Ctrl↵ 发送；⇧⌘↵ 只填不发（想先检查一遍再自己回车）
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send(!e.shiftKey)
              return
            }
            // 空输入时按 ↑ 取回上一条——发错了想改，不用重打
            if (e.key === 'ArrowUp' && !value) {
              e.preventDefault()
              setValue(lastRef.current)
              requestAnimationFrame(() => {
                const el = taRef.current
                if (el) {
                  autoGrow(el)
                  el.setSelectionRange(el.value.length, el.value.length)
                }
              })
              return
            }
            // Esc：清空并把焦点还给终端。误点进来时一键退出
            if (e.key === 'Escape') {
              e.preventDefault()
              setValue('')
              if (taRef.current) taRef.current.style.height = 'auto'
              onFocusTerm()
            }
          }}
        />
        <VoiceButton ptyId={ptyId} inline onText={appendVoice} />
        <button
          className="term-input-send"
          // 用 mousedown + preventDefault：click 会先让 textarea 失焦，
          // 焦点一走 :focus-within 的高亮就掉了，按钮看着像"点了个已经变灰的东西"
          onMouseDown={(e) => {
            e.preventDefault()
            send(true)
          }}
        >
          ⌘↵
        </button>
      </div>
    </div>
  )
}
