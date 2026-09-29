// 设置 › 系统管理 › 运行与资源。原 RuntimeMonitorPanel（右侧贴边的运行中心）的替代者。
// 数据逻辑没变：3 秒轮询 runtimeMonitor，只在本页挂着时跑；动作全走既有 IPC。
// 视觉稿 docs/prototype/2026-09-14-runtime-center.html 提案 02；决定见 docs/superpowers/specs/2026-09-14-runtime-settings-page-design.md
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { useT } from '../../i18n.ts'
import type { RuntimeMonitorSnapshot, RuntimeObservedService } from '../../../../shared/runtimeResources'
import { resolveStopNotice, type RuntimeStopNotice } from '../../../../shared/runtimeStopNotice'
import { runtimeProjectLabels } from '../../../../shared/runtimeProjectLabels'
import { OUTCOME_LABEL, fmtAgo, fmtDuration, matchProject, queueReasonLabel, servicesSummary } from './runtimeView'
import { RuntimeServiceCards } from './RuntimeServiceCards'
import { canLocateService, locateService } from './runtimeLocateActions'
import './runtimeSettings.css'

// 三段准入范围说明。**一字不删**，只是从列表前面折进「包含什么」里（settingsHierarchy.test 钉着）。
const gib = (n: number): string => (n / 1024 ** 3).toFixed(1)

function Meter({ value, threshold }: { value: number | null; threshold: number }): JSX.Element {
  const v = value ?? 0
  const cls = v >= threshold ? 'danger' : v >= threshold * 0.85 ? 'warn' : ''
  return (
    <div className={`rs-meter ${cls}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      <b style={{ left: `${threshold}%` }} data-l={`${threshold}%`} />
    </div>
  )
}

function SectionHead({ title, count, note, open, onToggle }: { title: string; count: number; note: string; open?: boolean; onToggle?: () => void }): JSX.Element {
  const tr = useT()
  return (
    <div className="rs-sec-hd">
      {onToggle ? (
        <button type="button" className="rs-tg" aria-expanded={open} onClick={onToggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg><span>{title}</span>
        </button>
      ) : <h4>{title}</h4>}
      <span className="rs-n">{count}</span>
      <details className="rs-note"><summary>{tr('settings.runtime.whatsIncluded')}</summary><p>{note}</p></details>
    </div>
  )
}

function Summary({ services, onClick }: { services: readonly RuntimeObservedService[]; onClick: () => void }): JSX.Element {
  const tr = useT()
  const s = servicesSummary(services)
  return (
    <button type="button" className="rs-sum" onClick={onClick} aria-label={tr('settings.runtime.expandServices')}>
      {s.kinds.map((k) => <span className="rs-k" key={k.kind}>{k.label}<b>{k.count}</b></span>)}
      {s.stopping > 0 && <span className="rs-att">{tr('settings.runtime.stoppingCount', { n: s.stopping })}</span>}
      <span className="rs-more">{tr('settings.runtime.expand')}</span>
    </button>
  )
}

// 三段准入范围说明的文案在词典 settings.runtime.note.*
export function RuntimeSettingsPage(): JSX.Element {
  const tr = useT()
  const NOTE = {
    tasks: tr('settings.runtime.note.tasks'),
    services: tr('settings.runtime.note.services'),
    recent: tr('settings.runtime.note.recent')
  }
  const projects = useStore((s) => s.projects)
  // runtimeProjectLabels 给的是「名字（id）」，卡片标题只要名字；主进程确认框里仍用带 id 的那份
  const labelOf = (id: string): string => runtimeProjectLabels([id], projects)[0].replace(/（[^）]*）$/, '') // i18n-allow: 匹配 runtimeProjectLabels 输出的全角括号后缀，不是界面文案
  const [sample, setSample] = useState<RuntimeMonitorSnapshot | null>(null)
  const [error, setError] = useState('')
  const [stopNotice, setStopNotice] = useState<RuntimeStopNotice>({ id: null, message: '' })
  const [taskNotice, setTaskNotice] = useState('')
  const [changingMode, setChangingMode] = useState(false)
  const [modeError, setModeError] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [mode, setMode] = useState<'project' | 'kind'>('project')
  // 折叠是本页的 state：每次打开设置都回到默认收起（这是「出问题时看一眼」的面板，别记住上次）
  const [openServices, setOpenServices] = useState(false)
  const [openRecent, setOpenRecent] = useState(false)

  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      try { const s = await window.api.runtimeMonitor(); if (alive) { setSample(s); setError('') } }
      catch { if (alive) { setSample(null); setError(tr('settings.runtime.readFailed')) } }
      finally { if (alive) timer = setTimeout(read, 3000) }
    }
    void read()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])
  useEffect(() => { setStopNotice((c) => resolveStopNotice(c, sample?.services)) }, [sample])

  const tasks = useMemo(() => (sample?.tasks ?? []).filter((t) => matchProject(projectFilter, [t.projectId])), [sample, projectFilter])
  const services = useMemo(() => (sample?.services ?? []).filter((s) => matchProject(projectFilter, s.projectIds.length ? s.projectIds : [null])), [sample, projectFilter])
  const recent = useMemo(() => (sample?.recent ?? []).filter((r) => matchProject(projectFilter, [r.projectId])), [sample, projectFilter])
  const involved = useMemo(() => [...new Set([...(sample?.tasks ?? []).map((t) => t.projectId), ...(sample?.services ?? []).flatMap((s) => s.projectIds), ...(sample?.recent ?? []).map((r) => r.projectId)].filter((id): id is string => !!id))], [sample])
  const threshold = sample?.threshold ?? (sample?.mode === 'eco' ? 50 : 80)
  const waiting = (sample?.tasks ?? []).filter((t) => t.state === 'queued').length
  const showServices = openServices || projectFilter !== ''
  const showRecent = openRecent || projectFilter !== ''

  const stop = async (service: RuntimeObservedService): Promise<void> => {
    try {
      const result = await window.api.runtimeStopPlugin(service.id)
      setStopNotice({ id: result.ok ? service.id : null, message: result.ok ? tr('settings.runtime.stopRequested') : (result.reason ?? tr('settings.runtime.notClosed')) })
    } catch { setStopNotice({ id: null, message: tr('settings.runtime.closeFailed') }) }
  }
  const memPct = sample && sample.memoryUsedBytes !== null && sample.totalMemoryBytes ? (sample.memoryUsedBytes / sample.totalMemoryBytes) * 100 : null

  return (
    <section className="rs-page" aria-label={tr('settings.nav.runtime.label')}>
      <div className="rs-modebar">
        <span>{tr('settings.runtime.dispatch.title')}</span>
        <span>{sample?.cliNetwork?.offline?tr('settings.runtime.waitNetwork'):tr('settings.runtime.dispatch.body', { sec: (sample?.cliNetwork?.intervalMs??1000)/1000 })}</span>
      </div>
      <div className="rs-modebar">
        <label><input type="checkbox" checked={sample?.idleRecoveryEnabled??true} disabled={!sample} onChange={async e=>{try{const next=await window.api.runtimeSetIdleRecovery(e.target.checked);setSample(s=>s?{...s,...next}:s)}catch{setModeError(tr('settings.runtime.idle.saveFailed'))}}}/>{tr('settings.runtime.idle.label')}</label>
        <span>{tr('settings.runtime.idle.note')}</span>
      </div>
      <div className="rs-modebar">
        <span>{tr('settings.runtime.mode.title')}</span>
        <div className="rs-seg" role="group" aria-label={tr('settings.runtime.mode.title')}>
          {(['normal', 'eco'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={sample?.mode === m} disabled={changingMode || !sample} onClick={async () => {
              setChangingMode(true); setModeError('')
              try { const next = await window.api.runtimeSetMode(m); setSample((s) => (s ? { ...s, ...next } : s)) }
              catch { setModeError(tr('settings.runtime.mode.saveFailed')) }
              finally { setChangingMode(false) }
            }}>{m === 'normal' ? tr('settings.runtime.mode.normal') : tr('settings.runtime.mode.eco')}<small>{m === 'normal' ? '80%' : '50%'}</small></button>
          ))}
        </div>
        <span className="rs-dim">{sample?.enforcement === 'plugin-tools' ? tr('settings.runtime.enforce.soft') : tr('settings.runtime.enforce.monitorOnly')}</span>
        <details className="rs-note rs-note-right"><summary>{tr('settings.runtime.threshold.summary')}</summary><p>{tr('settings.runtime.threshold.body')}{sample?.memoryMethod === 'mac-resident-estimate' ? tr('settings.runtime.threshold.resident') : sample ? tr('settings.runtime.threshold.method', { method: sample.memoryMethod }) : ''}</p></details>
      </div>
      {modeError && <p role="status">{modeError}</p>}
      {error ? <p role="status">{error}</p> : sample ? (
        <>
          {sample.metricsAvailable === false && <p role="status">{tr('settings.runtime.metricsDown')}</p>}
          <div className="rs-kpis">
            <div className="rs-tile"><div className="rs-lab"><span>CPU</span><em>{tr('settings.runtime.cores', { n: sample.logicalCpus || tr('settings.runtime.unknown') })}</em></div><div className="rs-val">{sample.cpuPercent === null ? tr('settings.runtime.sampling') : sample.cpuPercent.toFixed(1)}<small>%</small></div><Meter value={sample.cpuPercent} threshold={threshold} /></div>
            <div className="rs-tile"><div className="rs-lab"><span>{tr('settings.runtime.memory')}</span><em>{sample.memoryMethod === 'mac-resident-estimate' ? tr('settings.runtime.residentEstimate') : ''}</em></div><div className="rs-val">{sample.memoryUsedBytes === null ? tr('settings.runtime.unknown') : gib(sample.memoryUsedBytes)}<small>/ {sample.totalMemoryBytes ? gib(sample.totalMemoryBytes) : '?'} GB</small></div><Meter value={memPct} threshold={threshold} /></div>
            <div className="rs-tile rs-count"><div className="rs-lab"><span>{tr('settings.runtime.managedServices')}</span></div><div className="rs-val">{sample.services?.length ?? 0}</div></div>
            <div className="rs-tile rs-count"><div className="rs-lab"><span>{tr('settings.runtime.waiting')}</span></div><div className={`rs-val${waiting ? ' warn' : ''}`}>{waiting}</div></div>
          </div>
          <div className="rs-kpi-note"><span className="rs-dot" />{tr('settings.runtime.liveNote')}</div>
          <div className="rs-tools">
            {involved.length > 0 && (
              <select aria-label={tr('settings.runtime.filterByProject')} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="">{tr('settings.runtime.allProjects')}</option>
                {involved.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
                <option value="none">{tr('settings.runtime.noProject')}</option>
              </select>
            )}
            <div className="rs-seg" role="group" aria-label={tr('settings.runtime.groupBy')}>
              <button type="button" aria-pressed={mode === 'project'} onClick={() => setMode('project')}>{tr('settings.runtime.byProject')}</button>
              <button type="button" aria-pressed={mode === 'kind'} onClick={() => setMode('kind')}>{tr('settings.runtime.byKind')}</button>
            </div>
          </div>

          <section className="rs-sec">
            <SectionHead title={tr('settings.runtime.tasksTitle')} count={tasks.length} note={NOTE.tasks} />
            {taskNotice && <p role="status">{taskNotice}</p>}
            {!tasks.length ? <div className="rs-empty">{projectFilter ? tr('settings.runtime.noTasksFiltered') : tr('settings.runtime.noTasks')}</div> : (
              <div className="rs-list">
                {tasks.map((task) => (
                  <div className="rs-row" key={task.id}>
                    <div className="rs-row-main">
                      <div className="rs-row-name"><span>{task.name}</span>{task.scope === 'app' && <span className="rs-pill">{tr('settings.runtime.appLevel')}</span>}<span className="rs-pill">{task.projectId ? labelOf(task.projectId) : tr('settings.runtime.unlinked')}</span></div>
                      <div className="rs-row-meta">
                        {task.state === 'queued' ? <><span className="rs-st warn pulse">{tr('settings.runtime.queued')}</span><span>{queueReasonLabel(task.reason)}</span></> : task.state === 'cancel-requested' ? <span className="rs-st warn">{tr('settings.runtime.cancelPending')}</span> : <span className="rs-st ok">{tr('settings.runtime.running')}</span>}
                        <span>{fmtDuration(task.ageMs)}</span>
                      </div>
                    </div>
                    {task.scope === 'app' ? <span className="rs-pill" title={tr('settings.runtime.appCancelTip')}>{tr('settings.runtime.cannotCancel')}</span> : (
                      <button type="button" className="cset-btn" disabled={task.state === 'cancel-requested'} onClick={async () => {
                        try { const r = await window.api.runtimeCancelTask(task.id); setTaskNotice(r.ok ? tr('settings.runtime.cancelHandled') : tr('settings.runtime.taskGone')); if (r.ok) setSample(await window.api.runtimeMonitor()) }
                        catch { setTaskNotice(tr('settings.runtime.cancelFailed')) }
                      }}>{tr('settings.runtime.cancel')}</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rs-sec">
            <SectionHead title={tr('settings.runtime.managedServices')} count={services.length} note={NOTE.services} open={showServices} onToggle={() => setOpenServices((v) => !v)} />
            {stopNotice.message && <p role="status">{stopNotice.message}</p>}
            {!services.length ? <div className="rs-empty">{projectFilter ? tr('settings.runtime.noServicesFiltered') : tr('settings.runtime.noServices')}</div>
              : showServices ? <RuntimeServiceCards services={services} mode={mode} labelOf={labelOf} onStop={(s) => void stop(s)} onLocate={(s) => { locateService(s.id) }} canLocate={(s) => canLocateService(s.id)} />
              : <Summary services={services} onClick={() => setOpenServices(true)} />}
          </section>

          <section className="rs-sec">
            <SectionHead title={tr('settings.runtime.recentTitle')} count={recent.length} note={NOTE.recent} open={showRecent} onToggle={() => setOpenRecent((v) => !v)} />
            {!recent.length ? <div className="rs-empty">{projectFilter ? tr('settings.runtime.noRecordsFiltered') : tr('settings.runtime.noRecords')}</div>
              : showRecent ? (
                <div className="rs-list">
                  {recent.slice(0, 20).map((item, i) => (
                    <div className="rs-row rs-row-recent" key={item.id + ':' + i}>
                      <span className={`rs-st ${item.outcome === 'done' ? 'ok' : item.outcome === 'failed' ? 'bad' : item.outcome === 'timeout' ? 'warn' : 'off'}`} title={OUTCOME_LABEL[item.outcome]} />
                      <div className="rs-row-main">
                        <div className="rs-row-name"><span>{item.name}</span>{item.scope === 'app' && <span className="rs-pill">{tr('settings.runtime.appLevel')}</span>}<span className="rs-pill">{item.projectId ? labelOf(item.projectId) : tr('settings.runtime.unlinked')}</span></div>
                        <div className="rs-row-meta"><span>{OUTCOME_LABEL[item.outcome]}</span><span>{fmtAgo(item.ageMs)}</span>{item.durationMs >= 1000 && <span>{tr('settings.runtime.tookTime', { d: fmtDuration(item.durationMs) })}</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <button type="button" className="rs-sum" onClick={() => setOpenRecent(true)}>
                  <span>{tr('settings.runtime.latest')}<b>{recent[0].name}</b> · {OUTCOME_LABEL[recent[0].outcome]} · {fmtAgo(recent[0].ageMs)}</span><span className="rs-more">{tr('settings.runtime.expand')}</span>
                </button>
              )}
          </section>
          <div className="rs-foot"><span>{tr('settings.runtime.foot.a')}</span><span>{tr('settings.runtime.foot.b')}</span><span>{tr('settings.runtime.foot.c')}</span></div>
        </>
      ) : <p role="status">{tr('settings.runtime.loading')}</p>}
    </section>
  )
}
