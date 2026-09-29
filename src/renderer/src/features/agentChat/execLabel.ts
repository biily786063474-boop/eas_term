// 工具调用的标签（「运行 <命令>」「编辑 <文件>」…）是主进程按 CLI 事件拼好、随对话历史一起存下的，
// 所以在显示时按界面语言翻译前缀，而不是改存档格式（旧对话切到英文同样生效）。
// 来源：main/agentChat/claudeEvents.ts、codexEvents.ts、approvalRegistry.ts 的标签模板。
import { t } from '../../i18n.ts'

const PREFIXES: Array<[string, 'chat.exec.run' | 'chat.exec.edit' | 'chat.exec.read']> = [
  ['运行 ', 'chat.exec.run'], // i18n-allow: 与主进程标签模板逐字匹配
  ['编辑 ', 'chat.exec.edit'], // i18n-allow: 同上
  ['读取 ', 'chat.exec.read'] // i18n-allow: 同上
]
const EXACT: Record<string, 'chat.exec.editFiles' | 'chat.exec.create'> = {
  '修改文件': 'chat.exec.editFiles', // i18n-allow: 同上
  '创建': 'chat.exec.create' // i18n-allow: 同上
}

export function localizeExecLabel(label: string): string {
  const exact = EXACT[label]
  if (exact) return t(exact)
  for (const [prefix, key] of PREFIXES) {
    if (label.startsWith(prefix)) return t(key, { target: label.slice(prefix.length) })
  }
  return label
}
