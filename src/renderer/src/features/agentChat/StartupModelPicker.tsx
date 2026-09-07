import { useEffect, useState } from 'react'
import type { AgentChatModelCatalog, CliInfo } from '../../../../shared/agentChat'
import { startupParams, type StartupChoice } from './startupParams'

/** 父级以 CLI id 作 key：切换时卸载请求与目录，旧响应不会覆盖新 CLI。 */
export function StartupModelPicker({ cli, choice, roleModel, roleEffort, disabled, onChange }: {
  cli: CliInfo
  choice?: StartupChoice
  roleModel?: string
  roleEffort?: string
  disabled: boolean
  onChange: (choice: StartupChoice) => void
}): JSX.Element {
  const [catalog, setCatalog] = useState<AgentChatModelCatalog>({models:cli.capabilities.models ?? [],modelCatalog:{status:'loading',source:'none'}})
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setCatalog(c => ({...c, modelCatalog:{...c.modelCatalog,status:'loading'}}))
    void window.api.agentChat.modelCatalog(cli.id, refresh > 0).then(result => {
      if (active) setCatalog(result)
    }).catch(() => {
      if (active) setCatalog(c => ({...c,modelCatalog:{...c.modelCatalog,status:'error',note:'暂时无法读取模型，请重试'}}))
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
      <label>启动模型 <select aria-label="启动模型" className="ac-param-select" value={value.model} disabled={disabled} onChange={e => onChange({model:e.target.value,effort:''})}>
        <option value="">{roleModel ? `角色默认 · ${roleModel}` : '跟随 CLI 默认'}</option>
        {value.model && !catalog.models.some(m => m.id === value.model) && <option value={value.model}>{value.model}</option>}
        {catalog.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select></label>
      {levels.length > 0 && <label>思考强度 <select aria-label="启动思考强度" className="ac-param-select" value={value.effort} disabled={disabled} onChange={e => onChange({...value,effort:e.target.value})}>
        <option value="">{!value.model && roleEffort ? `角色默认 · ${roleEffort}` : '跟随模型默认'}</option>
        {levels.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select></label>}
      <button type="button" className="ac-bar-btn" aria-label="刷新启动模型清单" disabled={disabled || status === 'loading'} onClick={() => setRefresh(n=>n+1)}>刷新</button>
    </div>
    <div className="ac-startup-summary" role="status" title={note}>
      {modelLabel ? `首条消息使用 ${modelLabel}` : '首条消息跟随 CLI 配置，实际模型由 CLI 启动时确认'}
      {status === 'loading' ? ' · 正在读取模型…' : status === 'error' ? ' · 读取失败，可刷新重试' : ''}
      {source === 'cache' ? ' · 缓存清单' : source === 'fallback' ? ' · 内置清单' : ''}
    </div>
  </div>
}
