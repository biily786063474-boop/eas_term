import {runtimeProjectLabels} from '../../../../shared/runtimeProjectLabels'
import {useStore} from '../../store'
import {resolveStopNotice,type RuntimeStopNotice} from '../../../../shared/runtimeStopNotice'
import {useEffect,useState} from 'react'
import type {RuntimeMonitorSnapshot} from '../../../../shared/runtimeResources'
export function RuntimeMonitorPanel(){
 const projects=useStore(state=>state.projects)
 const [stopNotice,setStopNotice]=useState<RuntimeStopNotice>({id:null,message:''})
 const stopMessage=stopNotice.message
 const [taskNotice,setTaskNotice]=useState('')
 const [changingMode,setChangingMode]=useState(false),[modeError,setModeError]=useState('')
 const [sample,setSample]=useState<RuntimeMonitorSnapshot|null>(null),[error,setError]=useState('')
 // 按项目筛选（只是视图过滤，不改变归属与停止权限）。'' = 全部，'none' = 未关联
 const [projectFilter,setProjectFilter]=useState('')
 const matchProject=(ids:readonly (string|null)[])=>projectFilter===''?true:projectFilter==='none'?ids.every(id=>id===null):ids.includes(projectFilter)
 const involved=[...new Set([...(sample?.tasks??[]).map(t=>t.projectId),...(sample?.services??[]).flatMap(s=>s.projectIds),...(sample?.recent??[]).map(r=>r.projectId)].filter((id):id is string=>!!id))]
 const tasks=(sample?.tasks??[]).filter(t=>matchProject([t.projectId]))
 const services=(sample?.services??[]).filter(s=>matchProject(s.projectIds.length?s.projectIds:[null]))
 const recent=(sample?.recent??[]).filter(r=>matchProject([r.projectId]))
 const outcomeLabel={done:'完成',cancelled:'已取消',timeout:'排队超时',failed:'失败',exited:'已退出'} as const
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined
  const read=async()=>{
   try{const s=await window.api.runtimeMonitor();if(alive){setSample(s);setError('')}}
   catch{if(alive){setSample(null);setError('资源读数暂不可用')}}
   finally{if(alive)timer=setTimeout(read,3000)}
  }
  void read();return()=>{alive=false;if(timer)clearTimeout(timer)}
 },[])
 useEffect(()=>{setStopNotice(current=>resolveStopNotice(current,sample?.services))},[sample])
 const gib=(n:number)=>(n/1024**3).toFixed(1)+' GB'
 return <section className="cset-group" aria-label="运行资源监测">
  <h3>运行资源 <span className="cset-note">{sample?.enforcement==='plugin-tools'?'软准入':'仅监测'}</span></h3>
  <div className="cset-note">整机读数 · 当前准入范围为插件工具、终端、AI（含 ACP）与语言服务器启动，以及 ASR 模型启动与解码、VAD 与流式识别启动，尚未覆盖全部软件服务</div>
  <div role="group" aria-label="资源模式">
   {(['normal','eco'] as const).map(mode=><button key={mode} className="cset-btn" aria-pressed={sample?.mode===mode} disabled={changingMode||!sample} onClick={async()=>{
    setChangingMode(true);setModeError('')
    try{const next=await window.api.runtimeSetMode(mode);setSample(s=>s?{...s,...next}:s)}catch{setModeError('模式保存失败，原设置未改变')}finally{setChangingMode(false)}
   }}>{sample?.mode===mode?'✓ ':''}{mode==='normal'?'普通 · 80%':'节能 · 50%'}</button>)}
  </div>
  <div className="cset-note">普通80% / 节能50%：CPU或内存超阈值时暂停新工具；不是瞬时硬上限。未知成本工具保守串行，排队最长60秒，不自动重试。</div>
  {modeError&&<p role="status">{modeError}</p>}
  {error?<p role="status">{error}</p>:sample?<>
   {sample.metricsAvailable===false&&<p role="status">资源采样暂不可用，新任务保持等待；仍可取消任务和关闭所属服务。</p>}
   <p>CPU　{sample.cpuPercent===null?'采样中…':sample.cpuPercent.toFixed(1)+'%'}　·　{sample.logicalCpus||'未知'} 核</p>
   <p>内存　{sample.memoryUsedBytes===null?'未知':gib(sample.memoryUsedBytes)} / {sample.totalMemoryBytes?gib(sample.totalMemoryBytes):'未知'}</p>
   <div className="cset-note">{sample.memoryMethod==='mac-resident-estimate'?'内存为驻留占用估计，不等同系统内存压力。':'内存口径：'+sample.memoryMethod}　页面关闭即停止刷新。</div>
   {involved.length>0&&<div role="group" aria-label="按项目筛选" className="runtime-project-filter"><label className="cset-note">按项目筛选<select value={projectFilter} onChange={e=>setProjectFilter(e.target.value)}>
    <option value="">全部</option>
    {involved.map(id=><option key={id} value={id}>{runtimeProjectLabels([id],projects)[0]}</option>)}
    <option value="none">未关联项目</option>
   </select></label></div>}
   <h4>当前窗口的任务与启动队列</h4>
   <div className="cset-note">显示当前窗口的面板调用、终端、AI（含 ACP）与语言服务器启动、ASR 模型启动与解码、VAD 与流式识别启动，代码地图的符号索引、知识库图谱与体检的全库扫描、你点下的更新包下载，以及应用自己发起的 CLI 更新下载与插件服务器进程启动；不包含 AI 会话内部工具。取消是通知，不保证插件立即结束；应用级任务不归任何窗口，这里只显示不能取消。</div>
   {taskNotice&&<p role="status">{taskNotice}</p>}
   {!tasks.length?<p>{projectFilter?'该筛选下没有任务':'当前没有执行或等待中的任务'}</p>:tasks.map(task=><div key={task.id}>
    {task.state==='queued'&&<div className="cset-note">{task.reason==='memory-threshold'?'内存超过当前阈值':task.reason==='cpu-threshold'?'CPU超过当前阈值':task.reason==='metrics-unavailable'?'等待可靠资源采样':task.reason==='recovering'?'等待资源持续恢复':task.reason==='critical-pressure'?'系统内存压力过高':'等待运行名额或资源预算'}</div>}
    <p>{task.name} · {task.state==='cancel-requested'?'等待取消确认':task.state==='queued'?'排队中':'执行中'} · {Math.floor(task.ageMs/1000)} 秒</p>
    <div className="cset-note">项目：{runtimeProjectLabels(task.projectId?[task.projectId]:[],projects).join('、')||'未关联'}</div>
    {task.scope==='app'?<div className="cset-note">应用级任务：所有窗口可见，不能从窗口取消</div>:<button className="cset-btn" disabled={task.state==='cancel-requested'} onClick={async()=>{
     try{const r=await window.api.runtimeCancelTask(task.id);setTaskNotice(r.ok?'取消请求已处理；运行中的任务需等待实际结束':'任务已结束或不属于当前窗口');if(r.ok)setSample(await window.api.runtimeMonitor())}catch{setTaskNotice('取消通知失败，未关闭插件服务')}
    }}>取消任务</button>}
   </div>)}
   <h4>托管服务</h4>
   <div className="cset-note">当前列出插件宿主、终端、AI 进程（含 ACP）、语言服务器、ASR 驻留模型、VAD 及流式识别线程；流式音频采用有界缓冲，积压超限会停止并提示，不是逐帧硬限额。其它后台入口仍未全部覆盖。语言服务器仅启动受准入，存量索引工作尚不可抢占。跨窗口共享服务不可关闭。</div>
   {stopMessage&&<p role="status">{stopMessage}</p>}
   {!services.length?<p>{projectFilter?'该筛选下没有服务':'当前没有运行中的托管服务'}</p>:services.map(service=><div key={service.id}>
    <p>{service.name} · {service.state==='running'?'运行中':'停止中'} · {Math.floor(service.uptimeMs/60000)} 分钟</p>
    <button className="cset-btn" disabled={!service.canStop} onClick={async()=>{try{const result=await window.api.runtimeStopPlugin(service.id);setStopNotice({id:result.ok?service.id:null,message:result.ok?'已请求关闭，等待进程退出':result.reason??'未关闭'})}catch{setStopNotice({id:null,message:'关闭失败'})}}}>关闭服务</button>
    <div className="cset-note">项目：{runtimeProjectLabels(service.projectIds,projects).join('、')||'未关联'}{service.unknownRefs>0?` · ${service.unknownRefs} 个引用归属待识别`:''}</div>
   </div>)}
   <h4>最近结束</h4>
   <div className="cset-note">本窗口与应用级的任务、服务结束记录（完成 / 取消 / 排队超时 / 失败 / 退出），只留最近若干条，重启即清。</div>
   {!recent.length?<p>{projectFilter?'该筛选下没有记录':'还没有结束的任务或服务'}</p>:recent.slice(0,20).map((item,i)=><div key={item.id+':'+i}>
    <p>{item.name} · {outcomeLabel[item.outcome]} · {Math.floor(item.ageMs/1000)} 秒前{item.durationMs>=1000?` · 用时 ${Math.floor(item.durationMs/1000)} 秒`:''}</p>
    <div className="cset-note">项目：{runtimeProjectLabels(item.projectId?[item.projectId]:[],projects).join('、')||'未关联'}{item.scope==='app'?' · 应用级':''}</div>
   </div>)}
  </>:<p role="status">正在读取设备信息…</p>}
 </section>
}
