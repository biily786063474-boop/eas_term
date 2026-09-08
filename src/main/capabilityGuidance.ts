import path from 'node:path'
import type { CapabilityPreferences } from '../shared/builtinCapabilities.ts'

/** A small session-only route map. Prepared configuration is never described as a successful handshake. */
export function buildCapabilityGuidance(options: { preferences: CapabilityPreferences; directory: string; version: string; bizoneInstalled: boolean }): string {
  if (!options.preferences.guidance) return ''
  const link = (file: string): string => '`' + path.join(options.directory, file) + '`'
  const lines = ['## Eas-Term 内置能力（' + options.version + '）', '以下是本次受管会话的能力装配；是否已连接，以实际工具清单和调用结果为准。']
  if (options.preferences.workbench) {
    lines.push('报告、图片、预览放入所属 Frame：使用 Eas-Term MCP，按需读 ' + link('canvas.md') + '。')
    lines.push('操作画布前遵守 ' + link('SKILL.md') + ' 的边界与分寸；缺凭证时读 ' + link('secrets.md') + '，不要让用户把密钥发到聊天里。')
  } else lines.push('工作台模块已禁用，不要尝试恢复或绕过。')
  if (options.preferences.bizone) {
    lines.push(options.bizoneInstalled
      ? '笔纵连接器依赖已找到；生成前检查实际连接与账号状态，先报价再确认。按需读 ' + link('generate.md') + '。提交后断线不重复生成，结果未知时核对原任务。'
      : '笔纵应用或 MCP 依赖未找到，当前不能据此宣称可生成。')
  } else lines.push('笔纵模块已禁用，不要尝试自动启用。')
  lines.push('外部服务优先使用可用 MCP；插件查询与接入说明：' + link('plugins.md') + '。用户与项目原有规则继续适用。')
  return lines.join('\n')
}
