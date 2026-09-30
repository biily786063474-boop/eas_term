// 角色编辑器里契约输入框的占位提示。
//
// 单独一个文件是为了不让一大段示例挤在组件里。文案在词典里，调用时现取（切语言即时生效）。
import { t } from '../../i18n.ts'

export function roleContractHint(): string {
  return t('panels.role.contractExample')
}
