#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
const out='docs/verification/native-engine',dest=process.argv.includes('--dest')?process.argv[process.argv.indexOf('--dest')+1]:null
const css=fs.readFileSync('docs/diagnostics/2026-09-26-claude-first-message-timeout.html','utf8').match(/<style>([\s\S]*?)<\/style>/)[1]
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
for(let i=0;i<200;i++){
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}
const n=read('docs/verification/memory-attribution/progress.json'),a=read(out+'/ab-progress.json'),final=read(out+'/assessment.json')
const runs=fs.readdirSync(out).filter(n=>/^ab-.*\.json$/.test(n)&&n!=='ab-progress.json').map(n=>read(out+'/'+n)).filter(Boolean)
const rows=runs.map(r=>'<tr><td>'+esc(r.engine)+'</td><td>'+r.cycles+'</td><td>'+r.errors.filter(e=>e.message.includes('Widget')).length+'</td><td>'+r.errors.length+'</td><td>'+r.crashes.length+'</td><td>'+r.remainingOwnedCount+'</td></tr>').join('')
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+(!final?'<meta http-equiv="refresh" content="15">':'')+'<title>原生内存与引擎对照</title><style>'+css+'</style></head><body><main><div class="eyebrow">EAS-TERM · NATIVE MEMORY / ENGINE A-B</div><h1>继续定位，不盲目升级</h1><p class="lead">'+(final?'本轮采样结束':'隔离诊断进行中 · 每15秒刷新')+'</p><div class="card"><h3>当前进度</h3><p>原生分类：'+esc(n?.tag+' / '+n?.phase)+'</p><p>引擎对照：'+esc(a?.phase??'校验候选缓存与准备同样例')+'</p></div><h2>相同样例 · 每组40轮</h2><div class="tw"><table><thead><tr><th>Electron</th><th>循环</th><th>Widget错误</th><th>全部ERROR</th><th>崩溃</th><th>退出后剩余进程</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="warn"><h3>结论与边界</h3><p>'+esc(final?.conclusion??'vmmap能够采集VM分类，但无法完整解析Chromium PartitionAlloc malloc zone；不是完整原生分配调用栈。候选仅运行最小样例，不改项目依赖，不升级正式软件。')+'</p></div><div class="card"><p>'+esc(final?.details??'固定产品源码53f2334a；本机48GiB，无真实LLM请求。每组独立用户目录，测试进程自行退出。候选43.1.1为本地缓存对照，不冒充最新版本。')+'</p></div></main></body></html>'
for(const p of[out+'/progress.html',...(dest?[dest]:[])]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',html);fs.renameSync(p+'.tmp',p)}
if(final||process.argv.includes('--once'))break;await sleep(6000)
}
