import type { CliInfo } from '../../../../shared/agentChat'
import { RefreshIcon } from '../../ui/Icons'
import { SemanticIcon } from '../../ui/SemanticIcons'

/** Derived only from the selected CLI. A previous CLI's warning cannot survive a switch. */
export function StartupSetupCard({ cli, detecting, blockedByAuth, error, alternatives, onPick, onSetup, onRefresh }: {
  cli: CliInfo | null
  detecting: boolean
  blockedByAuth: boolean
  error: string | null
  alternatives: CliInfo[]
  onPick: (cli: CliInfo) => void
  onSetup: () => void
  onRefresh: () => void
}): JSX.Element | null {
  if (!detecting && !error && cli?.available && cli.chatSupported && !blockedByAuth) return null
  const missing = !!cli && !cli.available
  const terminalOnly = !!cli?.available && !cli.chatSupported
  const installable = missing && !cli?.bundled && !!cli?.installCmd
  const status = detecting ? '正在检测' : missing ? cli?.bundled ? '运行文件缺失' : '未安装'
    : terminalOnly ? '仅终端可用' : blockedByAuth ? cli?.auth === 'provider-key' ? '待配置' : '待登录' : '需要设置'
  const description = detecting ? '正在确认可用状态，请稍候。'
    : error ?? (missing ? cli?.bundled
      ? '这个运行环境随 Eas-Term 提供。请更新或修复 Eas-Term 安装包，再重新检测；也可以先换用已安装的 CLI。'
      : installable ? '安装后继续登录，完成设置后即可选择第一句话的模型。'
      : '当前没有自动安装方案。请按该 CLI 的安装说明完成安装，再点击重新检测。'
    : terminalOnly ? cli?.scopeNote ?? '这个 CLI 暂不支持 AI 对话，请在终端中使用。'
    : blockedByAuth ? cli?.auth === 'provider-key'
      ? '选择模型服务商，再使用它支持的订阅登录或 API key 完成配置。'
      : '请完成账号登录，然后回到这里继续。'
    : '选择一个 CLI 开始设置。')
  return <section className="ac-setup-card" data-cli={cli?.id} aria-label="启动设置" aria-busy={detecting}>
    <div className="ac-setup-heading"><SemanticIcon kind={cli?.auth === 'provider-key' ? 'integration' : 'terminal'} size={18} /><strong>{cli?.displayName ?? 'AI 对话'} · {status}</strong></div>
    <p role="status">{description}</p>
    <div className="ac-setup-actions">
      {!detecting && (installable || blockedByAuth) && <button type="button" className="ac-setup-primary" onClick={onSetup}>
        {installable ? '安装并继续' : cli?.auth === 'provider-key' ? '配置服务商' : '登录并继续'}
      </button>}
      <button type="button" className="ac-icon-button" aria-label="重新检测 CLI" data-tip="重新检测 CLI" disabled={detecting} onClick={onRefresh}><RefreshIcon size={18} /></button>
      {alternatives[0] && <button type="button" className="ac-setup-alternative" onClick={() => onPick(alternatives[0])}>改用 {alternatives[0].displayName}</button>}
    </div>
    <small>草稿会保留，完成设置后由你发送。</small>
  </section>
}
