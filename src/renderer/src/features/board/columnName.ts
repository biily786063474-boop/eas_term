// 看板列名的显示。内置三列（todo / doing / done）首次启动时按中文名写进 board.json，
// 那是存档数据不能改；显示时若它还是出厂名（没被用户改过），按当前语言显示。
// 用户改过名的列、自建的列原样显示。
import { t } from '../../i18n.ts'

const BUILTIN: Record<string, { zh: string; key: 'board.col.todo' | 'board.col.doing' | 'board.col.done' }> = {
  todo: { zh: '待执行', key: 'board.col.todo' }, // i18n-allow: 与 main/board.ts 出厂名比对
  doing: { zh: '进行中', key: 'board.col.doing' }, // i18n-allow: 与 main/board.ts 出厂名比对
  done: { zh: '已完结', key: 'board.col.done' } // i18n-allow: 与 main/board.ts 出厂名比对
}

export function columnName(c: { id: string; name: string }): string {
  const b = BUILTIN[c.id]
  return b && c.name === b.zh ? t(b.key) : c.name
}
