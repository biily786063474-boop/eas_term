// 看板列的定义（叫什么、什么颜色、排第几）。
//
// 单独一个文件而不是塞进 projects.json：列是**全局**的，项目只是记着自己在哪一列。
// 混在一起的话，删一个项目要小心别把列表也删了，读列表还得先把项目全读一遍。
//
// 内置三列（待执行 / 进行中 / 已完结）预置进去，但**和自建的列没有区别** ——
// 一样能改名、能删。硬留几个「删不掉的官方列」只会让人困惑：
// 别人的流程凭什么长成我们想的样子。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { BoardColumn } from '../shared/types'

const storeFile = (): string => path.join(app.getPath('userData'), 'board.json')

/** 首次启动铺的三列。id 用固定值而不是随机 —— 旧存档里项目的 status 就是这三个字符串，
 *  换成随机 id 的话所有已经打过标的项目一夜之间全变成「未分类」。 */
const DEFAULTS: BoardColumn[] = [
  { id: 'todo', name: '待执行', color: '#e0b45e' },
  { id: 'doing', name: '进行中', color: '#6fa8ff' },
  { id: 'done', name: '已完结', color: '#ef6f7b' }
]

function load(): BoardColumn[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    const list = Array.isArray(raw) ? raw : raw?.columns
    // 逐条校验：这是磁盘上的文件，改坏过一次就够受。少一个字段就整条丢掉，
    // 别让半个列跑到 UI 里去（列头空白、点了没反应，最难查的那种）
    if (Array.isArray(list)) {
      const ok = list.filter(
        (c): c is BoardColumn =>
          !!c && typeof c.id === 'string' && c.id.length > 0 && typeof c.name === 'string'
      )
      if (ok.length) return ok
    }
  } catch {
    // 文件不存在或损坏 → 回到默认三列
  }
  return DEFAULTS
}

function save(list: BoardColumn[]): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify({ version: 1, columns: list }, null, 2), 'utf8')
}

export function registerBoardHandlers(): void {
  ipcMain.handle('board:list', () => load())

  /** 整表落盘。增删改序都走这一条 —— 每个动作一个 handler 的话，
   *  「顺序」这种跨条目的改动没法原子地表达 */
  ipcMain.handle('board:save', (_e, list: BoardColumn[]) => {
    if (!Array.isArray(list)) return load()
    const clean = list
      .filter((c) => c && typeof c.id === 'string' && c.id.trim())
      .map((c) => ({
        id: String(c.id).slice(0, 64),
        name: String(c.name ?? '').trim().slice(0, 24) || '未命名',
        color: typeof c.color === 'string' ? c.color.slice(0, 32) : undefined
      }))
    save(clean)
    return clean
  })

  /** 发一个新 id。放主进程是因为 crypto.randomUUID 在渲染层要走 web crypto，
   *  两边生成规则不一致以后对不上 */
  ipcMain.handle('board:newId', () => 'col-' + crypto.randomUUID().slice(0, 8))
}
