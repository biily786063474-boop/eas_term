// 工具调用的标签（「运行 <命令>」「编辑 <文件>」…）是主进程按 CLI 事件拼好的中文，显示时才按界面语言翻译前缀
//（不改存档格式，旧对话切到英文同样生效）。
// 来源：main/agentChat/claudeEvents.ts、codexEvents.ts、approvalRegistry.ts 的标签模板。
// **渲染层（对话列表 / 审批卡）与主进程（发给手机的「正在做什么」）共用这一份**，翻译函数由调用方传入：
// 渲染层传 t，主进程传 tm。2026-10-02 从 renderer/features/agentChat/execLabel.ts 挪来，免得两份前缀表各改各的。
export type ExecLabelKey = 'chat.exec.run' | 'chat.exec.edit' | 'chat.exec.read' | 'chat.exec.editFiles' | 'chat.exec.create'
type Translate = (key: ExecLabelKey, params?: Record<string, string>) => string

const PREFIXES: Array<[string, 'chat.exec.run' | 'chat.exec.edit' | 'chat.exec.read']> = [
  ['运行 ', 'chat.exec.run'], // i18n-allow: 与主进程标签模板逐字匹配
  ['编辑 ', 'chat.exec.edit'], // i18n-allow: 同上
  ['读取 ', 'chat.exec.read'], // i18n-allow: 同上
  ['修改 ', 'chat.exec.edit'] // i18n-allow: 审批卡片标题（approvalRegistry.ts 的 patch 模板）
]
const EXACT: Record<string, 'chat.exec.editFiles' | 'chat.exec.create'> = {
  '修改文件': 'chat.exec.editFiles', // i18n-allow: 同上
  '创建': 'chat.exec.create' // i18n-allow: 同上
}

export function localizeExecLabelWith(label: string, translate: Translate): string {
  const exact = EXACT[label]
  if (exact) return translate(exact)
  for (const [prefix, key] of PREFIXES) {
    if (label.startsWith(prefix)) return translate(key, { target: label.slice(prefix.length) })
  }
  return label
}
