// 终端输入框右键插入的待办清单：勾选/编辑/增删都要落盘，关掉软件重开还在。
//
// 存储按「一个 key 对应一份清单」组织，key 是什么字符串由渲染层决定——
// 主进程不关心语义。渲染层的取舍（见 features/terminal/useTerminalTodos.ts）：
// 优先用画布节点 id（这个 app 里唯一扛得住重启的终端身份——leafId/ptyId
// 每次开终端都是新的一个，只有画布节点自己的 id 落盘后还认得出来，
// 见 store/canvasSlice.ts 的 materializeCanvas），没上画布的纯分屏终端
// 退化成会话内的 key，重启后天然孤儿——这和纯分屏终端本来就不会在重启后
// 还存在是同一件事，不是这个功能单独的缺陷。
//
// 照 board.ts 的范式：主进程管文件、逐条校验、IPC + preload 暴露、坏数据整条丢。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import type { TodoItem } from '../shared/types'

const storeFile = (): string => path.join(app.getPath('userData'), 'todos.json')

/** 单条文字的上限。清单是给人扫一眼的待办，不是备忘录正文 */
const MAX_TEXT = 500
/** 单份清单的条目上限，防止某个 key 被写坏后无限膨胀 */
const MAX_ITEMS = 300
/** key 长度上限——画布节点 id / `leaf:<leafId>` 都远小于这个数，超出说明数据不对劲 */
const MAX_KEY = 128

type TodoMap = Record<string, TodoItem[]>

function load(): TodoMap {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    const map = raw?.lists
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {}
    const out: TodoMap = {}
    // 逐条校验：这是磁盘上的文件，改坏过一次就够受。少一个字段的条目直接丢掉，
    // 别让半条数据跑进 UI 里去（勾选框状态不对、点了没反应，最难查的那种）
    for (const [key, v] of Object.entries(map)) {
      if (typeof key !== 'string' || !key || key.length > MAX_KEY) continue
      if (!Array.isArray(v)) continue
      out[key] = v.filter(
        (it): it is TodoItem =>
          !!it &&
          typeof it === 'object' &&
          typeof (it as TodoItem).id === 'string' &&
          typeof (it as TodoItem).text === 'string' &&
          typeof (it as TodoItem).done === 'boolean'
      )
    }
    return out
  } catch {
    // 文件不存在或损坏 → 空表（不是空清单——每个 key 各自的「有没有清单」由 get 返回 null 表达）
    return {}
  }
}

function save(map: TodoMap): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify({ version: 1, lists: map }, null, 2), 'utf8')
}

/** 整份清单落盘前的清洗：字段裁剪 + 条目数量上限，和 board.ts 的字段裁剪同一个思路 */
function cleanItems(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
    .slice(0, MAX_ITEMS)
    .map((it) => ({
      id: String(it.id ?? '').slice(0, 64),
      text: String(it.text ?? '').slice(0, MAX_TEXT),
      done: it.done === true
    }))
    .filter((it) => it.id.length > 0)
}

export function registerTodoHandlers(): void {
  // 返回 null 表示「这个 key 从没存过清单」，和「存过但是空清单」（返回 []）是两件事——
  // 前者是「还没插入」，后者是「插入了但一条没加」，渲染层要能分清楚哪种该显示什么
  ipcMain.handle('todos:get', (_e, key: string) => {
    if (typeof key !== 'string' || !key) return null
    const map = load()
    return map[key] ?? null
  })

  // 整份清单落盘：增删改都走它，「顺序」这种跨条目的改动没法拆成单条表达（同 board:save 的取舍）
  ipcMain.handle('todos:save', (_e, key: string, items: unknown) => {
    if (typeof key !== 'string' || !key || key.length > MAX_KEY) return { ok: false }
    const map = load()
    map[key] = cleanItems(items)
    save(map)
    return { ok: true }
  })

  // 删掉整份清单（不是清空条目）——key 直接从表里消失，下次 get 回 null
  ipcMain.handle('todos:remove', (_e, key: string) => {
    if (typeof key !== 'string' || !key) return { ok: true }
    const map = load()
    delete map[key]
    save(map)
    return { ok: true }
  })
}
