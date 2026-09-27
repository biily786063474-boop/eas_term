#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
const out='docs/verification/pressure-recovery',dest=process.argv.includes('--dest')?process.argv[process.argv.indexOf('--dest')+1]:null
const css=fs.readFileSync('docs/diagnostics/2026-09-26-claude-first-message-timeout.html','utf8').match(/<style>([\s\S]*?)<\/style>/)[1]
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}
for(let i=0;i<240;i++){
 const p=read(out+'/progress.json'),r=read(out+'/'+(p?.tag||'media')+'-result.json'),q=read(out+'/queue/progress.json'),qr=read(out+'/queue/result.json'),a=read(out+'/assessment.json')
 const rows=(r?.cycleResults||[]).map(c=>'<tr><td>'+c.cycle+'</td><td>'+c.level+'</td><td>'+c.reopenMs+' ms</td><td>'+c.interactionMs+' ms</td><td>'+[c.imageZoom,c.modelThetaDelta?.toFixed(3),c.webClickCount,c.pluginReadRpc?'RPC通过':'待验'].map(esc).join(' / ')+'</td></tr>').join('')
 const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+(!a?'<meta http-equiv="refresh" content="15">':'')+'<title>压力回收后恢复验收</title><style>'+css+'</style></head><body><main><div class="eyebrow">EAS-TERM · PRESSURE RECOVERY</div><h1>回收后，仍要能用</h1><p class="lead">'+(a?'本轮结果已汇总':'隔离实例持续验证 · 每15秒刷新')+'</p><div class="card"><h3>当前进度</h3><p>内容恢复：'+esc(p?.tag+' / '+p?.phase)+'</p><p>队列：'+esc(q?.phase??'等待内容场景结束后顺序执行')+'</p></div><h2>真实组件恢复与交互</h2><div class="tw"><table><thead><tr><th>轮次</th><th>模拟通知</th><th>内容重开</th><th>整组交互</th><th>图片缩放 / 3D旋转 / 网页计数 / 插件RPC</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="warn"><h3>结论与边界</h3><p>'+esc(a?.conclusion??'压力通知只发送测试实例，不填充整机内存。图片缩放、3D鼠标拖拽、网页输入点击、插件只读RPC；队列采用真实调度器加可控准入门，不发送模型请求。')+'</p><p>'+esc(a?.details??'Trace测量有额外进程与缓冲，RSS不作为性能基准；不升级Electron、不添加生产强制GC。')+'</p>'+(r?.error?'<p>采样失败：'+esc(r.error)+'</p>':'')+'</div><div class="card">队列结果：'+esc(qr?JSON.stringify({passed:qr.passed,finalStarts:qr.finalStarts,sourceRestored:qr.sourceRestored,error:qr.error}):'尚未完成')+'</div></main></body></html>'
 for(const file of[out+'/progress.html',...(dest?[dest]:[])]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',html);fs.renameSync(file+'.tmp',file)}
 if(a||process.argv.includes('--once'))break;await sleep(6000)
}
