// 设置 › 系统管理 › 运行与资源。原 RuntimeMonitorPanel（右侧贴边的运行中心）的替代者。
// 数据逻辑没变：3 秒轮询 runtimeMonitor，只在本页挂着时跑；动作全走既有 IPC。
// 视觉稿 docs/prototype/2026-09-14-runtime-center.html 提案 02；决定见 docs/superpowers/specs/2026-09-14-runtime-settings-page-design.md
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import type { RuntimeMonitorSnapshot, RuntimeObservedService } from '../../../../shared/runtimeResources'
import { resolveStopNotice, type RuntimeStopNotice } from '../../../../shared/runtimeStopNotice'
import { runtimeProjectLabels } from '../../../../shared/runtimeProjectLabels'
import { OUTCOME_LABEL, fmtAgo, fmtDuration, matchProject, queueReasonLabel, servicesSummary } from './runtimeView'
import { RuntimeServiceCards } from './RuntimeServiceCards'
import './runtimeSettings.css'

// 三段准入范围说明。**一字不删**，只是从列表前面折进「包含什么」里（settingsHierarchy.test 钉着）。
const NOTE = {
  tasks: '显示当前窗口的面板调用、终端、AI（含 ACP）与语言服务器启动、ASR 模型启动与解码、VAD 与流式识别启动，代码地图的符号索引、知识库图谱与体检的全库扫描、你点下的更新包下载，以及应用自己发起的 CLI 更新下载与插件服务器进程启动；不包含 AI 会话内部工具。取消是通知，不保证插件立即结束；应用级任务不归任何窗口，这里只显示不能取消。',
  services: '当前列出插件宿主、终端、AI 进程（含 ACP）、语言服务器、ASR 驻留模型、VAD 及流式识别线程；流式音频采用有界缓冲，积压超限会停止并提示，不是逐帧硬限额。其它后台入口仍未全部覆盖。语言服务器仅启动受准入，存量索引工作尚不可抢占。跨窗口共享服务不可关闭。',
  recent: '本窗口与应用级的任务、服务结束记录（完成 / 取消 / 排队超时 / 失败 / 退出），只留最近若干条，重启即清。'
}
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
  return (
    <div className="rs-sec-hd">
      {onToggle ? (
        <button type="button" className="rs-tg" aria-expanded={open} onClick={onToggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg><span>{title}</span>
        </button>
      ) : <h4>{title}</h4>}
      <span className="rs-n">{count}</span>
      <details className="rs-note"><summary>包含什么 ▾</summary><p>{note}</p></details>
    </div>
  )
}

function Summary({ services, onClick }: { services: readonly RuntimeObservedService[]; onClick: () => void }): JSX.Element {
  const s = servicesSummary(services)
  return (
    <button type="button" className="rs-sum" onClick={onClick} aria-label="展开托管服务">
      {s.kinds.map((k) => <span className="rs-k" key={k.kind}>{k.label}<b>{k.count}</b></span>)}
      {s.stopping > 0 && <span className="rs-att">{s.stopping} 个停止中</span>}
      <span className="rs-more">展开</span>
    </button>
  )
}

export function RuntimeSettingsPage(props: { onLocate?: (service: RuntimeObservedService) => void; canLocate?: (service: RuntimeObservedService) => boolean } = {}): JSX.Element {
  const projects = useStore((s) => s.projects)
  // runtimeProjectLabels 给的是「名字（id）」，卡片标题只要名字；主进程确认框里仍用带 id 的那份
  const labelOf = (id: string): string => runtimeProjectLabels([id], projects)[0].replace(/（[^）]*）$/, '')
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
      catch { if (alive) { setSample(null); setError('资源读数暂不可用') } }
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
      setStopNotice({ id: result.ok ? service.id : null, message: result.ok ? '已请求关闭，等待进程退出' : (result.reason ?? '未关闭') })
    } catch { setStopNotice({ id: null, message: '关闭失败' }) }
  }
  const memPct = sample && sample.memoryUsedBytes !== null && sample.totalMemoryBytes ? (sample.memoryUsedBytes / sample.totalMemoryBytes) * 100 : null

  return (
    <section className="rs-page" aria-label="运行与资源">
      <div className="rs-modebar">
        <span>资源模式</span>
        <div className="rs-seg" role="group" aria-label="资源模式">
          {(['normal', 'eco'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={sample?.mode === m} disabled={changingMode || !sample} onClick={async () => {
              setChangingMode(true); setModeError('')
              try { const next = await window.api.runtimeSetMode(m); setSample((s) => (s ? { ...s, ...next } : s)) }
              catch { setModeError('模式保存失败，原设置未改变') }
              finally { setChangingMode(false) }
            }}>{m === 'normal' ? '普通' : '节能'}<small>{m === 'normal' ? '80%' : '50%'}</small></button>
          ))}
        </div>
        <span className="rs-dim">{sample?.enforcement === 'plugin-tools' ? '软准入：插件工具、终端、AI 与语言服务器启动' : '仅监测'}</span>
        <details className="rs-note rs-note-right"><summary>阈值怎么起作用 ▾</summary><p>普通 80% / 节能 50%：CPU 或内存超过当前阈值时暂停启动新工具，不是瞬时硬上限。未知成本的工具保守串行，排队最长 60 秒，不自动重试。{sample?.memoryMethod === 'mac-resident-estimate' ? '内存为驻留占用估计，不等同系统内存压力。' : sample ? `内存口径：${sample.memoryMethod}。` : ''}</p></details>
      </div>
      {modeError && <p role="status">{modeError}</p>}
      {error ? <p role="status">{error}</p> : sample ? (
        <>
          {sample.metricsAvailable === false && <p role="status">资源采样暂不可用，新任务保持等待；仍可取消任务和关闭所属服务。</p>}
          <div className="rs-kpis">
            <div className="rs-tile"><div className="rs-lab"><span>CPU</span><em>{sample.logicalCpus || '未知'} 核</em></div><div className="rs-val">{sample.cpuPercent === null ? '采样中' : sample.cpuPercent.toFixed(1)}<small>%</small></div><Meter value={sample.cpuPercent} threshold={threshold} /></div>
            <div className="rs-tile"><div className="rs-lab"><span>内存</span><em>{sample.memoryMethod === 'mac-resident-estimate' ? '驻留估计' : ''}</em></div><div className="rs-val">{sample.memoryUsedBytes === null ? '未知' : gib(sample.memoryUsedBytes)}<small>/ {sample.totalMemoryBytes ? gib(sample.totalMemoryBytes) : '?'} GB</small></div><Meter value={memPct} threshold={threshold} /></div>
            <div className="rs-tile rs-count"><div className="rs-lab"><span>托管服务</span></div><div className="rs-val">{sample.services?.length ?? 0}</div></div>
            <div className="rs-tile rs-count"><div className="rs-lab"><span>等待中</span></div><div className={`rs-val${waiting ? ' warn' : ''}`}>{waiting}</div></div>
          </div>
          <div className="rs-kpi-note"><span className="rs-dot" />整机读数 · 每 3 秒刷新 · 离开本页即停止</div>
          <div className="rs-tools">
            {involved.length > 0 && (
              <select aria-label="按项目筛选" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="">全部项目</option>
                {involved.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
                <option value="none">未关联项目</option>
              </select>
            )}
            <div className="rs-seg" role="group" aria-label="分组方式">
              <button type="button" aria-pressed={mode === 'project'} onClick={() => setMode('project')}>按项目</button>
              <button type="button" aria-pressed={mode === 'kind'} onClick={() => setMode('kind')}>按类型</button>
            </div>
          </div>

          <section className="rs-sec">
            <SectionHead title="任务与启动队列" count={tasks.length} note={NOTE.tasks} />
            {taskNotice && <p role="status">{taskNotice}</p>}
            {!tasks.length ? <div className="rs-empty">{projectFilter ? '该筛选下没有任务' : '当前没有执行或等待中的任务'}</div> : (
              <div className="rs-list">
                {tasks.map((task) => (
                  <div className="rs-row" key={task.id}>
                    <div className="rs-row-main">
                      <div className="rs-row-name"><span>{task.name}</span>{task.scope === 'app' && <span className="rs-pill">应用级</span>}<span className="rs-pill">{task.projectId ? labelOf(task.projectId) : '未关联'}</span></div>
                      <div className="rs-row-meta">
                        {task.state === 'queued' ? <><span className="rs-st warn pulse">排队中</span><span>{queueReasonLabel(task.reason)}</span></> : task.state === 'cancel-requested' ? <span className="rs-st warn">等待取消确认</span> : <span className="rs-st ok">执行中</span>}
                        <span>{fmtDuration(task.ageMs)}</span>
                      </div>
                    </div>
                    {task.scope === 'app' ? <span className="rs-pill" title="所有窗口可见，不能从窗口取消">不能取消</span> : (
                      <button type="button" className="cset-btn" disabled={task.state === 'cancel-requested'} onClick={async () => {
                        try { const r = await window.api.runtimeCancelTask(task.id); setTaskNotice(r.ok ? '取消请求已处理；运行中的任务需等待实际结束' : '任务已结束或不属于当前窗口'); if (r.ok) setSample(await window.api.runtimeMonitor()) }
                        catch { setTaskNotice('取消通知失败，未关闭插件服务') }
                      }}>取消</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rs-sec">
            <SectionHead title="托管服务" count={services.length} note={NOTE.services} open={showServices} onToggle={() => setOpenServices((v) => !v)} />
            {stopNotice.message && <p role="status">{stopNotice.message}</p>}
            {!services.length ? <div className="rs-empty">{projectFilter ? '该筛选下没有服务' : '当前没有运行中的托管服务'}</div>
              : showServices ? <RuntimeServiceCards services={services} mode={mode} labelOf={labelOf} onStop={(s) => void stop(s)} onLocate={props.onLocate} canLocate={props.canLocate} />
              : <Summary services={services} onClick={() => setOpenServices(true)} />}
          </section>

          <section className="rs-sec">
            <SectionHead title="最近结束" count={recent.length} note={NOTE.recent} open={showRecent} onToggle={() => setOpenRecent((v) => !v)} />
            {!recent.length ? <div className="rs-empty">{projectFilter ? '该筛选下没有记录' : '还没有结束的任务或服务'}</div>
              : showRecent ? (
                <div className="rs-list">
                  {recent.slice(0, 20).map((item, i) => (
                    <div className="rs-row rs-row-recent" key={item.id + ':' + i}>
                      <span className={`rs-st ${item.outcome === 'done' ? 'ok' : item.outcome === 'failed' ? 'bad' : item.outcome === 'timeout' ? 'warn' : 'off'}`} title={OUTCOME_LABEL[item.outcome]} />
                      <div className="rs-row-main">
                        <div className="rs-row-name"><span>{item.name}</span>{item.scope === 'app' && <span className="rs-pill">应用级</span>}<span className="rs-pill">{item.projectId ? labelOf(item.projectId) : '未关联'}</span></div>
                        <div className="rs-row-meta"><span>{OUTCOME_LABEL[item.outcome]}</span><span>{fmtAgo(item.ageMs)}</span>{item.durationMs >= 1000 && <span>用时 {fmtDuration(item.durationMs)}</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <button type="button" className="rs-sum" onClick={() => setOpenRecent(true)}>
                  <span>最新 <b>{recent[0].name}</b> · {OUTCOME_LABEL[recent[0].outcome]} · {fmtAgo(recent[0].ageMs)}</span><span className="rs-more">展开</span>
                </button>
              )}
          </section>
          <div className="rs-foot"><span>取消是通知，不保证插件立即结束</span><span>跨窗口共享服务不可关闭</span><span>应用级任务不归任何窗口</span></div>
        </>
      ) : <p role="status">正在读取设备信息…</p>}
    </section>
  )
}
