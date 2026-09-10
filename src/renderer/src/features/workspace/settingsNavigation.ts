// 导航只描述信息层级，不复制偏好值或快捷键注册表。
export const SETTINGS_PAGES = [
 {key:'theme',label:'外观',group:'工作体验',description:'配色与界面呈现，让工作台保持熟悉。',keywords:'主题 暗色 亮色 跟随系统 灵动岛'},
 {key:'board',label:'画板',group:'工作体验',description:'管理快照完成后的标记行为。',keywords:'快照 清空 保留 标记'},
 {key:'sound',label:'声音与提醒',group:'工作体验',description:'决定哪些时刻需要声音提醒。',keywords:'提示音 音量 试听 完成 审批'},
 {key:'keys',label:'快捷键',group:'工作体验',description:'按使用场景查找键位，作用域始终可见。',keywords:'键盘 改键 恢复默认 冲突 分屏'},
 {key:'ai',label:'AI 对话',group:'AI 与连接',description:'先决定如何协作，再决定如何授权。',keywords:'先问再做 OMP harness 权限 强制审批 Claude 额度 上下文 statusLine'},
 {key:'mcp',label:'MCP 接入',group:'AI 与连接',description:'管理 AI 对工作台的工具调用。',keywords:'工具 记录 接入 允许 拒绝'},
 {key:'phone',label:'手机连接',group:'AI 与连接',description:'连接你的手机，远程查看电脑上的项目。',keywords:'配对 二维码 局域网 Wi-Fi 隧道 设备'},
 {key:'update',label:'更新',group:'系统管理',description:'应用与 AI CLI 的更新分别管理。',keywords:'版本 自动更新 Claude Code Codex OMP'},
 {key:'perf',label:'性能与诊断',group:'系统管理',description:'图形状态与问题排查放在同一个地方。',keywords:'GPU 加速 栅格化 2D 卡顿 黑匣子 闪烁 日志 事件'},
 {key:'privacy',label:'隐私与扩展',group:'系统管理',description:'清楚知道采集了什么、在本机写入了什么。',keywords:'匿名 统计 扩展 卸载 配置 隐私'}
] as const
export type SettingsPageKey = (typeof SETTINGS_PAGES)[number]['key']
export function settingsPage(key: unknown): (typeof SETTINGS_PAGES)[number] {
 return SETTINGS_PAGES.find(p=>p.key===key) ?? SETTINGS_PAGES[0]
}
export function findSettingsPages(query: string): (typeof SETTINGS_PAGES)[number][] {
 const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean)
 return SETTINGS_PAGES.filter(p=>terms.every(t=>[p.label,p.group,p.description,p.keywords].join(' ').toLowerCase().includes(t)))
}
