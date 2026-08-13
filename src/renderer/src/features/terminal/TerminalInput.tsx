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
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { ImageIcon } from '../../ui/Icons'
import { VoiceButton } from '../voice/VoiceButton'
import { stopVoiceOnSend } from '../voice/voiceControl'
import { track } from '../notify/track'
import { noteSubmitted, drainFollow } from '../gantt/collector'
import { CanvasContextMenu } from '../canvas/CanvasContextMenu'
import { useTerminalTodos } from './useTerminalTodos'
import { TerminalTodoPanel } from './TerminalTodoPanel'

/** 文本写进 pty 之后隔多久再发回车。
 *  给 TUI 一点时间把这段文本渲染进它自己的输入框——不隔开的话回车会被当成
 *  「粘贴还没结束」吞掉，内容就停在 agent 的输入框里发不出去。
 *  80ms 是「肉眼无感」和「够 TUI 反应」之间的取舍。 */
const ENTER_DELAY_MS = 80

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
  leafId,
  onFocusTerm
}: {
  ptyId: string
  /** 待办清单挂靠用——见 useTerminalTodos 顶部注释，为什么不能直接用 ptyId */
  leafId: string
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

  // 待办清单：右键菜单插入，勾选状态持久化（见 useTerminalTodos 顶部注释）
  const todos = useTerminalTodos(leafId)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // 刚拍的画板快照：浮层只在同项目的终端里出现（见 uiSlice 里 lastSnapshot 的注释）
  const lastSnapshot = useStore((s) => s.lastSnapshot)
  const setLastSnapshot = useStore((s) => s.setLastSnapshot)
  // 这个终端属于哪个项目。Sidebar 和 projectMenu 里已经是这个查法，沿用同一套。
  //
  // **必须把 projectId 算在 selector 里返回 primitive**，不能写成
  // `useStore((s) => s.tabs)` 再 useMemo：那是按数组引用比较的响应式订阅，而
  // PaneLayer 会把所有 tab 的所有 leaf 都挂上（隐藏的也在），N 个终端就有 N 个
  // TerminalInput 各订阅一次 —— tabs 引用一变（setSplitRatio 拖分隔条时每次
  // mousemove 都造新数组、setActiveLeaf 同理）就是 N 次重渲染 + N 次全树遍历，O(N²)。
  // 同一个坑仓库里已经防过两次（tabsSlice.ts:251 setTabTitle 标题没变时短路、
  // TerminalView.tsx:567 特意用非响应式的 getState），这里不能再开一个口子。
  // 返回 string|null 之后 zustand 按值比较：项目没变就不重渲染。
  const myProjectId = useStore(
    (s) => s.tabs.find((t) => collectLeaves(t.root).some((l) => l.id === leafId))?.projectId ?? null
  )

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
      track('image')
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

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, LINE_H * MAX_ROWS) + 'px'
  }

  /** 送进 pty。withReturn=false 时只填不发，光标停在那儿等你自己按回车 */
  const send = (withReturn: boolean): void => {
    const text = value.trim()
    if (!text && !imgs.length) return
    // 一发送就收麦。放在这里而不是各个触发点上：⌘↵ 和发送按钮都收敛到这个函数，
    // 挂在这儿才是「不管从哪发都会停」。不 await——消息该立刻走，
    // 收麦是它旁边的事，慢一点不该拖住发送。
    void stopVoiceOnSend()
    lastRef.current = text
    // 图片路径排在文字前面：agent 先看到「有图」，再读你要它干什么。
    // 带空格的路径要加引号，否则会被读成两个文件。
    const paths = imgs.map((i) => (/\s/.test(i.path) ? `"${i.path}"` : i.path)).join(' ')
    const payload = paths ? (text ? `${paths} ${text}` : paths) : text

    // 多行要用 bracketed paste 包起来，否则 TUI 会把每个换行都当成「提交」——
    // 一段三行的提示词会被拆成三条消息发出去。单行不需要，少一层转义少一层出错可能。
    const body = payload.includes('\n') ? `\x1b[200~${payload}\x1b[201~` : payload
    window.api.pty.write(ptyId, body)

    // 甘特图采集：记的是 payload（含图片路径）之外的纯文本意图。
    // 采集是附加功能，绝不能拖累主功能：包一层 try/catch，抛了也不能让下面的回车重发被跳过
    try {
      noteSubmitted(ptyId, text)
      drainFollow(ptyId)
    } catch (err) {
      console.error('[gantt] noteSubmitted/drainFollow 失败', err)
    }

    if (withReturn) {
      // **回车必须单独发，而且要隔一小会儿。**
      //
      // 原来是 `payload + '\r'` 一次写进去，对 shell 没问题，但 Claude Code / Codex
      // 这类 TUI 收到一大段文本后要先渲染进它自己的输入框，紧跟着的回车常常被它
      // 当成「还在粘贴」吞掉 —— 表现就是内容躺在 agent 的输入框里，没发出去，
      // 你还得自己去按一次回车。粘图时尤其明显：路径长，渲染更慢。
      window.setTimeout(() => window.api.pty.write(ptyId, '\r'), ENTER_DELAY_MS)
    }
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

  /** 语音定稿落进框里。
   *
   *  **落在光标处，不是末尾。** 原先无脑追加到最后，于是「写了一段话 → 回头想在中间补一句 →
   *  把光标挪过去说话」，结果那句还是接在了末尾，得再剪切粘贴一次。
   *  连着说几句时光标会跟着往后走，所以多句仍然是顺着排的。
   *
   *  没聚焦输入框时（比如刚点完麦克风、焦点还在按钮上）没有可信的光标位置，退回追加到末尾。 */
  const appendVoice = (text: string): void => {
    const el = taRef.current
    const focused = !!el && document.activeElement === el
    const at = focused ? (el.selectionStart ?? el.value.length) : null
    const end = focused ? (el.selectionEnd ?? at!) : null

    setValue((prev) => {
      if (at === null || end === null) {
        // 末尾追加：和前一句之间补个空格，除非本来就以空白结尾
        return (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + text
      }
      const before = prev.slice(0, at)
      const after = prev.slice(end)
      // 插在词中间时两侧各补一个空格，否则会和原有的字黏成一坨
      const lead = before && !/\s$/.test(before) ? ' ' : ''
      const tail = after && !/^\s/.test(after) ? ' ' : ''
      return before + lead + text + tail + after
    })

    requestAnimationFrame(() => {
      const e2 = taRef.current
      if (!e2) return
      autoGrow(e2)
      if (at === null) return
      // 光标推到刚插入这段之后，接着说下一句才会顺着排
      const before = e2.value.slice(0, at)
      const lead = before && !/\s$/.test(before) ? 1 : 0
      const pos = at + lead + text.length
      e2.focus()
      e2.setSelectionRange(pos, pos)
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
      <TerminalTodoPanel todos={todos} />
      {err && <div className="term-input-err">{err}</div>}
      {lastSnapshot && myProjectId && lastSnapshot.projectId === myProjectId && (
        <div className="term-snap-chip">
          <button className="term-snap-take" onClick={() => void takeSnapshotIn()}>
            <ImageIcon size={12} />
            <span>刚拍的画板快照</span>
          </button>
          <button className="term-snap-x" onClick={() => setLastSnapshot(null)}>
            ×
          </button>
        </div>
      )}
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
          onContextMenu={(e) => {
            e.preventDefault()
            // 画布模式下 .terminal-host / CanvasStage 各自还挂着别的右键菜单监听
            // （见 TerminalView.tsx、stageMenu.ts 里对 .term-input 的排除注释）。
            // 这里既然已经自己接管了，就把事件摁住，别让它继续冒泡出去撞见那些菜单
            e.stopPropagation()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
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
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: todos.exists ? '待办清单' : '插入待办清单',
              // 已经插过：右键只是把面板展开给你看，不重新建一份、不清空已有条目
              hint: todos.exists ? `${todos.items.filter((it) => it.done).length}/${todos.items.length}` : undefined,
              onClick: () => todos.ensure()
            }
          ]}
        />
      )}
    </div>
  )
}
