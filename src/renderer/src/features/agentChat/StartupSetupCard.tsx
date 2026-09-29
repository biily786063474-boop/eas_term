import type { CliInfo } from '../../../../shared/agentChat'
import { useT } from '../../i18n.ts'
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
  const t = useT()
  if (!detecting && !error && cli?.available && cli.chatSupported && !blockedByAuth) return null
  const missing = !!cli && !cli.available
  const terminalOnly = !!cli?.available && !cli.chatSupported
  const installable = missing && !cli?.bundled && !!cli?.installCmd
  const status = detecting ? t('chat.setup.detecting') : missing ? cli?.bundled ? t('chat.setup.runtimeMissing') : t('chat.setup.notInstalled')
    : terminalOnly ? t('chat.setup.terminalOnly') : blockedByAuth ? cli?.auth === 'provider-key' ? t('chat.setup.needConfig') : t('chat.setup.needLogin') : t('chat.setup.needSetup')
  const description = detecting ? t('chat.setup.descChecking')
    : error ?? (missing ? cli?.bundled
      ? t('chat.setup.descBundledMissing')
      : installable ? t('chat.setup.descInstallable')
      : t('chat.setup.descNoAuto')
    : terminalOnly ? cli?.scopeNote ?? t('chat.setup.descNoChat')
    : blockedByAuth ? cli?.auth === 'provider-key'
      ? t('chat.setup.descProviderKey')
      : t('chat.setup.descLogin')
    : t('chat.setup.descPick'))
  return <section className="ac-setup-card" data-cli={cli?.id} aria-label={t('chat.setup.cardAria')} aria-busy={detecting}>
    <div className="ac-setup-heading"><SemanticIcon kind={cli?.auth === 'provider-key' ? 'integration' : 'terminal'} size={18} /><strong>{cli?.displayName ?? t('chat.setup.aiChat')} · {status}</strong></div>
    <p role="status">{description}</p>
    <div className="ac-setup-actions">
      {!detecting && (installable || blockedByAuth) && <button type="button" className="ac-setup-primary" onClick={onSetup}>
        {installable ? t('chat.setup.install') : cli?.auth === 'provider-key' ? t('chat.setup.configProvider') : t('chat.setup.login')}
      </button>}
      <button type="button" className="ac-icon-button" aria-label={t('chat.setup.redetect')} data-tip={t('chat.setup.redetect')} disabled={detecting} onClick={onRefresh}><RefreshIcon size={18} /></button>
      {alternatives[0] && <button type="button" className="ac-setup-alternative" onClick={() => onPick(alternatives[0])}>{t('chat.setup.switchTo', { name: alternatives[0].displayName })}</button>}
    </div>
    <small>{t('chat.setup.draftKept')}</small>
  </section>
}
