#!/usr/bin/env node
// Local-only progress page. Reuses the project's existing diagnostic report styling.
import fs from 'node:fs'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
const out=path.resolve('docs/verification/memory-soak'),dest=process.argv.slice(2).find(v=>!v.startsWith('--'))
const template=fs.readFileSync('docs/diagnostics/2026-09-26-claude-first-message-timeout.html','utf8')
const css=template.match(/<style>([\s\S]*?)<\/style>/)[1]
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const mib=n=>typeof n==='number'?(n/1024**2).toFixed(1):'—'
for(let turn=0;turn<240;turn++){
 const r=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8')),p=JSON.parse(fs.readFileSync(path.join(out,'progress.json'),'utf8'))
 const last=r.samples.at(-1),done=!!r.cleanup
 let assessment='功能测试通过不等于没有内存泄漏；需要对比每轮关闭及最终空闲趋势。'
 try{assessment=JSON.parse(fs.readFileSync(path.join(out,'assessment.json'),'utf8')).conclusion}catch{}
 const rows=r.cycleResults.map(x=>'<tr><td>'+x.cycle+'</td><td>'+mib(x.residentBytes)+'</td><td>'+x.processCount+'</td><td>'+mib(x.heapUsedBytes)+'</td><td>'+x.targetCount+'</td></tr>').join('')
 const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+(!done?'<meta http-equiv="refresh" content="15">':'')+'<title>内存测试 · 实时进度</title><style>'+css+'</style></head><body><main><div class="eyebrow">EAS-TERM · MEMORY VERIFICATION</div><h1>无账号内存测试</h1><p class="lead">'+(done?(r.passed?'本轮功能验收结束':'本轮发生失败'):'隔离实例持续采样中')+'</p><div class="grid"><div class="stat"><b>'+Math.round(r.elapsedSeconds/60)+' 分钟</b><span>已运行时间</span></div><div class="stat"><b>'+r.cycleResults.length+' / '+r.configuration.cycles+'</b><span>已完成开关轮次</span></div><div class="stat"><b>'+mib(last?.processTree?.residentBytes)+' MiB</b><span>最近一次应用进程树 RSS</span></div></div><div class="card"><h3>当前阶段</h3><p>'+esc(p.phase)+'</p><p>更新时间 '+esc(p.at)+'；样本 '+r.samples.length+'；源码 '+esc(r.sourceCommit.slice(0,8))+'</p><p>运行时专项：178 通过 / 3 条件跳过；70 秒排队保留、手动取消、恢复后只启动一次已通过。</p></div><h2>每轮关闭后的读数</h2><div class="tw"><table><thead><tr><th>轮次</th><th>RSS MiB</th><th>进程数</th><th>主渲染堆 MiB</th><th>调试目标数</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="warn"><h3>结论与边界</h3><p>'+esc(assessment)+'</p><p>本机 '+Math.round(r.physicalMemoryBytes/1024**3)+' GiB；真实图片、3D、离线网页、插件和空闲 AI 面板，不发送模型消息，不向整机施加内存压力。不代表实体 16GB、Claude 首发、Windows 或通宵稳定性验收。</p>'+(r.error?'<p>'+esc(r.error)+'</p>':'')+'</div><div class="decision">'+(done?'隔离启动器已退出：'+esc(r.cleanup.launcherExited):'每 15 秒刷新一次；仅本地文件，未托管。')+'<br>report preset 原文件在本机缺失；复用项目已有诊断报告的完整样式，不重新选型。</div></main></body></html>'
 for(const file of [path.join(out,'progress.html'),...(dest?[dest]:[])]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',html);fs.renameSync(file+'.tmp',file)}
 if(done||process.argv.includes('--once'))break
 await sleep(6000)
}
