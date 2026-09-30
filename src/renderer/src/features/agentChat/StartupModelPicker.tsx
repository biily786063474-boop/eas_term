import { ComposerSettings } from './ComposerSettings'
import { EffortSlider } from './EffortSlider'
import { useEffect, useState, type ReactNode } from 'react'
import type { AgentChatModelCatalog, CliInfo } from '../../../../shared/agentChat'
import { useT } from '../../i18n.ts'
import { RefreshIcon } from '../../ui/Icons'
import { startupParams, type StartupChoice } from './startupParams'

/** 父级以 CLI id 作 key：切换时卸载请求与目录，旧响应不会覆盖新 CLI。 */
export function StartupModelPicker({ cli, choice, roleModel, roleEffort, disabled, actions, onChange }: {
  cli: CliInfo
  choice?: StartupChoice
  roleModel?: string
  roleEffort?: string
  disabled: boolean
  actions?: ReactNode
  onChange: (choice: StartupChoice) => void
}): JSX.Element {
  const t = useT()
  const [catalog, setCatalog] = useState<AgentChatModelCatalog>({models:cli.capabilities.models ?? [],modelCatalog:{status:'loading',source:'none'}})
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setCatalog(c => ({...c, modelCatalog:{...c.modelCatalog,status:'loading'}}))
    void window.api.agentChat.modelCatalog(cli.id, refresh > 0).then(result => {
      if (active) setCatalog(result)
    }).catch(() => {
      if (active) setCatalog(c => ({...c,modelCatalog:{...c.modelCatalog,status:'error',note:t('chat.startupModel.readFail')}}))
    })
    return () => { active = false }
  }, [cli.id, refresh])
  const value = choice ?? {model:'',effort:''}
  const params = startupParams(choice, roleModel, roleEffort)
  const levels = catalog.models.find(m => m.id === params.model)?.effortLevels ?? cli.capabilities.effortLevels ?? []
  const { status, source, note } = catalog.modelCatalog
  const modelLabel = catalog.models.find(m => m.id === params.model)?.label ?? params.model
  return <div className="ac-startup-models">
    <div className="ac-startup-controls">
      <ComposerSettings label={modelLabel || t('chat.startupModel.defaultModel')} disabled={disabled}>
      <span className="ac-settings-label">{t('chat.startupModel.useModel')}</span>
      <label><select aria-label={t('chat.startupModel.ariaModel')} className="ac-param-select" value={value.model} disabled={disabled} onChange={e => onChange({model:e.target.value,effort:''})}>
        <option value="">{roleModel ? t('chat.startupModel.roleDefault', { name: roleModel }) : t('chat.startupModel.followCli')}</option>
        {value.model && !catalog.models.some(m => m.id === value.model) && <option value={value.model}>{value.model}</option>}
        {catalog.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select></label>
      {levels.length > 0 && <span className="ac-settings-label">{t('chat.startupModel.effort')}</span>}
      <EffortSlider defaultDescription={!value.model && roleEffort ? t('chat.startupModel.roleDefault', { name: roleEffort }) : t('chat.startupModel.followModelEffort')} levels={levels} value={value.effort} onChange={effort => onChange({...value,effort})} />
      <button type="button" className="ac-icon-button" aria-label={t('chat.startupModel.refreshAria')} data-tip={t('chat.startupModel.refreshTip')} disabled={disabled || status === 'loading'} onClick={() => setRefresh(n=>n+1)}><RefreshIcon size={18} /></button>
    <div className="ac-startup-summary" role="status" title={note}>
      {modelLabel ? t('chat.startupModel.summaryModel', { model: modelLabel }) : t('chat.startupModel.summaryCli')}
      {params.effort ? ` · ${params.effort}` : ''}
      {status === 'loading' ? t('chat.startupModel.loadingModels') : status === 'error' ? t('chat.startupModel.loadFailed') : ''}
      {source === 'cache' ? t('chat.startupModel.cached') : source === 'fallback' ? t('chat.startupModel.builtin') : ''}
    </div>
      </ComposerSettings>
      {actions}
    </div>
  </div>
}
