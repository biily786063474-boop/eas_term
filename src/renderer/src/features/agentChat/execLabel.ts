// 工具调用标签的显示翻译。逻辑在 shared/execLabel.ts（主进程发给手机的「正在做什么」也用它），这里只接上渲染层的 t。
import { t } from '../../i18n.ts'
import { localizeExecLabelWith } from '../../../../shared/execLabel.ts'

export function localizeExecLabel(label: string): string {
  return localizeExecLabelWith(label, t)
}
