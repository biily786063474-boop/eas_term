import fs from 'node:fs'
import path from 'node:path'

/** Real renderer and mouse interactions; setup transports are explicitly simulated. */
export async function verifyChatIntegration({ cdp, projectDir, root, waitFor }) {
  const out = path.join(root, 'docs/verification/agent-chat')
  const checks = []
  const check = (ok, name, data) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(data)); checks.push({ name, data }); console.log('[integration] ✓',name) }
  const shot = async name => { await new Promise(r=>setTimeout(r,200)); const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64')) }
  const caps = { contextUsage: true, approval: [], models: [] }
  let clis = [{ id:'claude',displayName:'Claude Code',available:false,chatSupported:true,installCmd:'test-only-install',capabilities:caps },{id:'codex',displayName:'Codex',available:true,chatSupported:true,capabilities:caps},{id:'omp',displayName:'默认 harness',available:false,chatSupported:true,bundled:true,auth:'provider-key',capabilities:caps}]
  const fixture = (extra = {}) => cdp.eval(`window.__agentChatTestSetup(${JSON.stringify({ clis, ...extra })})`)
  const choose = async name => {
    await cdp.clickElement(`document.querySelector('.ac-ctxbar button[data-tip="换一个 CLI"]')`, 'CLI 菜单')
    await cdp.clickElement(`Array.from(document.querySelectorAll('.cctx-item')).find(b=>b.querySelector('.cctx-label')?.textContent===${JSON.stringify(name)})`, name)
  }
  const ready = () => waitFor(() => cdp.eval(`!document.querySelector('.ac-setup-card')`), { timeout:12000, desc:'检测完成，没有旧提示' })
  await fixture()
  await cdp.eval(`(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',tabs:[{id:'integration-tab',title:'UI 验证',cwd:${JSON.stringify(projectDir)},activeLeafId:'integration-leaf',root:{type:'leaf',id:'integration-leaf',pane:{kind:'agent',cwd:${JSON.stringify(projectDir)},cli:'codex'}}}],activeTabId:'integration-tab',canvas:{...s.canvas,frames:[{id:'integration-frame',name:'UI 验证',projectId:null,x:0,y:0,w:1000,h:800,collapsed:false,nodes:[{id:'integration-node',leafId:'integration-leaf',x:48,y:60,w:850,h:700}]}]}});s.setMaximizedNode({frameId:'integration-frame',nodeId:'integration-node'})})()`)
  await waitFor(() => cdp.eval(`!!document.querySelector('textarea.ac-input')`), { timeout:12000, desc:'启动界面' })
  await ready()
  await cdp.clickElement(`document.querySelector('textarea.ac-input')`, '草稿')
  await cdp.send('Input.insertText', { text:'这条草稿在切换和安装后必须保留' })
  await choose('Claude Code')
  check(await cdp.eval(`document.querySelector('.ac-setup-card')?.textContent.includes('安装并继续') && document.querySelector('.ac-ctxbar').textContent.includes('Claude Code') && document.querySelector('[aria-label="发送消息"]').disabled`), '未安装选择与引导归属一致，禁止启动')
  await shot('integration-missing')
  await choose('Codex'); await ready()
  check(await cdp.eval(`document.querySelector('textarea.ac-input').value.includes('必须保留') && !document.querySelector('.ac-cli-note')`), '切到已安装项清除旧提示并保留草稿')
  // Same-object selection must still recheck auth, never bypass the logged-out gate.
  await fixture({ loggedIn:false }); await choose('Codex')
  await waitFor(() => cdp.eval(`document.querySelector('.ac-setup-card')?.textContent.includes('登录并继续')`), { timeout:12000, desc:'登录闸门' })
  await choose('Codex')
  await waitFor(() => cdp.eval(`document.querySelector('.ac-setup-card')?.textContent.includes('登录并继续')`), { timeout:12000, desc:'重复选择仍需登录' })
  check(await cdp.eval(`document.querySelector('[aria-label="发送消息"]').disabled`), '重复选择当前 CLI 不绕过登录')
  // A late logged-out answer for Codex cannot overwrite a new Claude selection.
  await fixture({ loggedIn:false, delay:800 }); await choose('Codex')
  await fixture(); await choose('Claude Code')
  await new Promise(r=>setTimeout(r,1000))
  check(await cdp.eval(`document.querySelector('.ac-setup-card')?.dataset.cli==='claude' && document.querySelector('.ac-setup-card').textContent.includes('安装并继续')`), '旧认证响应不能写入新 CLI')
  await cdp.clickElement(`document.querySelector('.ac-setup-actions .ac-setup-primary')`, '启动模拟安装')
  await waitFor(() => cdp.eval(`!!document.querySelector('.ac-setup [role="progressbar"]')`), { timeout:8000, desc:'真实安装面板进度' })
  await cdp.eval(`window.__agentChatTestInstallEvent({cli:'claude',phase:'failed',error:'测试网络中断',output:['测试安装输出']})`)
  await waitFor(() => cdp.eval(`document.querySelector('.ac-setup')?.textContent.includes('测试网络中断')`), { timeout:8000, desc:'失败输出' })
  await shot('integration-install-failed')
  await cdp.clickElement(`Array.from(document.querySelectorAll('.ac-setup button')).find(b=>b.textContent.includes('再试一次'))`, '重试模拟安装')
  clis = clis.map(c=>c.id==='claude'?{...c,available:true}:c)
  await fixture()
  await cdp.eval(`window.__agentChatTestInstallEvent({cli:'claude',phase:'done'})`)
  await waitFor(() => cdp.eval(`!!document.querySelector('.ac-login-url')`), { timeout:8000, desc:'安装完成接登录' })
  await cdp.eval(`window.__agentChatTestLoginEvent({cli:'claude',phase:'done'})`)
  await waitFor(() => cdp.eval(`!document.querySelector('.ac-setup-mask')`), { timeout:8000, desc:'登录完成关闭面板' })
  await ready()
  check(await cdp.eval(`document.querySelector('.ac-ctxbar').textContent.includes('Claude Code') && document.querySelector('textarea.ac-input').value.includes('必须保留') && window.__agentChatTestStartCalls().length===0`), '安装登录后重查就绪，保持 CLI/草稿，不自动发送')
  await choose('默认 harness')
  check(await cdp.eval(`document.querySelector('.ac-setup-card').textContent.includes('运行文件缺失') && !document.querySelector('.ac-setup-card .ac-setup-primary')`), '内置缺失不会调用外部 CLI 安装')
  await choose('Codex'); await ready()
  await cdp.clickElement(`document.querySelector('[aria-label="发送消息"]')`, '发送到模拟会话')
  await waitFor(() => cdp.eval(`!!document.querySelector('.ac-toolbar')`), { timeout:12000, desc:'对话态' })
  const push = event => cdp.eval(`window.__agentChatTestPush('e2e-fake-session',${JSON.stringify(event)})`)
  for (let i=0;i<10;i++) {
    await push({k:'user.message',text:'第 '+(i+1)+' 条导航提问'})
    await push({k:'turn.start'})
    await push({k:'text.done',text:('第 '+(i+1)+' 条回答，检查真实列表滚动与间距。\n\n').repeat(8)})
    await push({k:'exec.start',execId:'read-'+i,label:'读取文件',detail:'src/example.ts',kind:'read'})
    await push({k:'exec.done',execId:'read-'+i,ok:true,output:'读取完成'})
    await push({k:'turn.done',usage:{inputTokens:100,outputTokens:100}})
  }
  await waitFor(() => cdp.eval(`document.querySelectorAll('.ac-question-ticks > button').length>=10`), { timeout:8000, desc:'真实提问目录' })
  const count = await cdp.eval(`document.querySelectorAll('.ac-question-ticks > button').length`)
  await shot('integration-navigation-before-click')
  check(await cdp.eval(`(()=>{const el=document.querySelectorAll('.ac-question-ticks > button')[2];const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`), '最大化面板不会遮挡提问刻度')
  await cdp.clickElement(`document.querySelectorAll('.ac-question-ticks > button')[2]`, '导航第三问')
  await waitFor(() => cdp.eval(`document.querySelectorAll('.ac-question-ticks > button')[2]?.hasAttribute('aria-current')`), { timeout:8000, desc:'目录定位高亮' })
  await waitFor(async () => {
    const p=await cdp.eval(`(()=>{const r=document.querySelector('.ac-messages');return {offset:document.querySelectorAll('[data-question-index]')[2].getBoundingClientRect().top-r.getBoundingClientRect().top,scrollTop:r.scrollTop,height:r.clientHeight,scrollHeight:r.scrollHeight}})()`)
    if(p.offset>=36&&p.offset<64&&p.scrollTop>0)return true
    throw new Error(JSON.stringify(p))
  }, { timeout:8000, desc:'平滑滚动到达目标' })
  const position = await cdp.eval(`(()=>{const root=document.querySelector('.ac-messages'),r=root.getBoundingClientRect();const t=root.querySelectorAll('[data-question-index]')[2].getBoundingClientRect();return {offset:t.top-r.top,scrollTop:root.scrollTop,paddingTop:getComputedStyle(root).paddingTop}})()`)
  check(position.scrollTop>0 && position.offset>=36 && position.offset<64 && position.paddingTop==='0px', '点击定位真实提问且吸顶零 padding 保持', position)
  const hover = await cdp.eval(`(()=>{const r=document.querySelectorAll('.ac-question-ticks > button')[4].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover})
  await waitFor(() => cdp.eval(`document.querySelector('.ac-question-preview')?.textContent.includes('条回答')`), { timeout:8000, desc:'悬停真实摘要' })
  await shot('integration-navigation-dark')
  await cdp.eval(`document.documentElement.dataset.theme='light'`); await shot('integration-navigation-light')
  check(await cdp.eval(`!!document.querySelector('.ac-exec-row [data-icon-kind="read"]') && !!document.querySelector('[aria-label="新对话"]') && !!document.querySelector('[aria-label="语音输入"]')`), '工具语义图标及旧聊天动作入口保留')
  // Restore through the real FLIP path, then verify the portal follows the chat module, independently of its containing frame.
  await cdp.eval(`window.__store.getState().setMaximizedNode(null);window.__store.getState().setViewport({x:100,y:10,scale:.8})`)
  await waitFor(() => cdp.eval(`(()=>{const pane=document.querySelector('[data-leaf-id="integration-leaf"]');const nav=document.querySelector('.ac-question-nav');return pane&&!pane.getAnimations().some(a=>a.playState==='running')&&nav?.classList.contains('outside')&&Math.abs(nav.getBoundingClientRect().left-(pane.getBoundingClientRect().left-38))<2})()`), { timeout:8000, desc:'还原缩放后导航跟随 AI 对话模块外侧' })
  await shot('integration-navigation-canvas')
  check(true,'最大化还原和画布缩放后导航贴合 AI 对话模块外侧')
  const railGap = () => cdp.eval(`(()=>{const p=document.querySelector('[data-leaf-id="integration-leaf"]').getBoundingClientRect();const n=document.querySelector('.ac-question-nav').getBoundingClientRect();return {pane:p.left,nav:n.left,gap:p.left-n.right}})()`)
  const beforeFrameMove=await railGap()
  // Move the frame's boundary while keeping the chat module at the same world position.
  await cdp.eval(`(()=>{const s=window.__store.getState();window.__store.setState({canvas:{...s.canvas,frames:s.canvas.frames.map(f=>f.id==='integration-frame'?{...f,x:f.x-120,w:f.w+120,nodes:f.nodes.map(n=>({...n,x:n.x+120}))}:f)}})})()`)
  await waitFor(async()=>{const r=await railGap();return Math.abs(r.pane-beforeFrameMove.pane)<2&&Math.abs(r.nav-beforeFrameMove.nav)<2&&Math.abs(r.gap-12)<2},{timeout:8000,desc:'Frame 边界改变不能牵动提问导航'})
  check(true,'Frame 独立移位时导航仍固定在对话模块外 12px')
  // Moving just the chat module must move its rail by the same screen distance.
  await cdp.eval(`(()=>{const s=window.__store.getState();window.__store.setState({canvas:{...s.canvas,frames:s.canvas.frames.map(f=>f.id==='integration-frame'?{...f,w:f.w+120,nodes:f.nodes.map(n=>({...n,x:n.x+100}))}:f)}})})()`)
  await waitFor(async()=>{const r=await railGap();return Math.abs((r.pane-beforeFrameMove.pane)-80)<2&&Math.abs((r.nav-beforeFrameMove.nav)-80)<2&&Math.abs(r.gap-12)<2},{timeout:8000,desc:'移动对话模块后导航保持固定间距'})
  check(true,'模块独立移动后导航同步移动，缩放下仍保持 12px 间距')
  await shot('integration-navigation-module-anchor')

  // Selection owns visibility, including any preview that was open when selection changed.
  const selectedTick=await cdp.eval(`(()=>{const r=document.querySelector('.ac-question-ticks button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...selectedTick})
  await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-question-preview')`),{timeout:8000,desc:'取消选中前显示悬停预览'})
  await cdp.eval(`window.__store.getState().clearCanvasSel()`)
  await waitFor(()=>cdp.eval(`!document.querySelector('.ac-question-nav')&&!document.querySelector('.ac-question-preview')&&!document.querySelector('.ac-messages').dataset.questionRail`),{timeout:8000,desc:'取消模块选中后隐藏导航与预览'})
  check(true,'取消选中隐藏导航、悬停预览并释放正文留白')
  await shot('integration-navigation-unselected')
  await cdp.eval(`window.__store.getState().setCanvasSel(['f:integration-frame'])`)
  check(await cdp.eval(`!document.querySelector('.ac-question-nav')`),'只选中 Frame 不显示对话导航')
  await cdp.clickElement(`document.querySelector('[data-leaf-id="integration-leaf"] .pane-header')`,'重新选中对话模块')
  await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-question-nav')`),{timeout:8000,desc:'重新选中模块显示导航'})
  check(await cdp.eval(`!document.querySelector('.ac-question-preview')`),'重新选中恢复导航，不恢复旧悬停预览')
  await shot('integration-navigation-selected')

  check(await cdp.eval(`Number(getComputedStyle(document.querySelector('.ac-question-nav')).zIndex)<Number(getComputedStyle(document.querySelector('.canvas-drawer')).zIndex)`),'普通画布导航层级低于文件抽屉')
  // Real file reads from the isolated registered project; never touch user files.
  for (const name of ['afterPack.js','icon.png','icon.svg','entitlements.mac.plist','AGENTS.md']) fs.writeFileSync(path.join(projectDir,name),'')
  await cdp.eval(`window.__store.setState({activeProjectId:'t8-verify-project',resDrawerOpen:true});window.dispatchEvent(new CustomEvent('fs-dir-changed',{detail:${JSON.stringify(projectDir)}}))`)
  await shot('integration-drawer-before-check')
  await waitFor(async () => {
    const s=await cdp.eval(`({icons:[...document.querySelectorAll('.canvas-drawer [data-icon-kind]')].map(e=>e.dataset.iconKind),text:document.querySelector('.canvas-drawer')?.textContent,projects:window.__store.getState().projects,active:window.__store.getState().activeProjectId})`)
    if(['javascript','vector','config','image','skill'].every(k=>s.icons.includes(k)))return true
    throw new Error(JSON.stringify(s))
  }, { timeout:8000, desc:'共享文件树实际读取与图标' })
  await waitFor(()=>cdp.eval(`(()=>{const nav=document.querySelector('.ac-question-nav'),d=document.querySelector('.canvas-drawer').getBoundingClientRect();return !nav || nav.getBoundingClientRect().left>=d.right})()`),{timeout:8000,desc:'提问导航让位于展开的文件抽屉'})
  await shot('integration-drawer-icons')
  check(true,'左侧抽屉真实文件按 JS / 图片 / SVG / plist / Agent 规则分类')
  const peer={type:'leaf',id:'integration-peer',pane:{kind:'agent',cwd:projectDir,cli:'codex',worktree:{relPath:'.worktrees/peer',branch:'codex/peer'}}}
  await cdp.eval(`(()=>{const s=window.__store.getState(),tab=s.tabs[0];window.__originalChatPane=document.querySelector('[data-leaf-id="integration-leaf"]');window.__store.setState({viewMode:'split',resDrawerOpen:false,tabs:[{...tab,root:{type:'split',id:'integration-split',dir:'row',ratio:.5,children:[{...tab.root,pane:{...tab.root.pane,worktree:{relPath:'.worktrees/main',branch:'codex/main'}}},${JSON.stringify(peer)}]}}]})})()`)
  await waitFor(() => cdp.eval(`document.querySelectorAll('.ac-branch [data-icon-kind="worktree"]').length===2`),{timeout:12000,desc:'分屏独立 Worktree 徽标'})
  await cdp.eval(`window.__store.getState().setActiveLeaf('integration-tab','integration-peer')`)
  await waitFor(()=>cdp.eval(`!document.querySelector('.ac-question-nav[data-leaf="integration-leaf"]')`),{timeout:8000,desc:'分屏切换到其他模块后隐藏原对话导航'})
  await cdp.eval(`window.__store.getState().setActiveLeaf('integration-tab','integration-leaf')`)
  await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-question-nav[data-leaf="integration-leaf"]')`),{timeout:8000,desc:'分屏激活对话后恢复导航'})
  check(true,'分屏导航只跟随当前激活对话')
  const splitState=await cdp.eval(`(()=>{const layer=document.querySelector('.pane-layer');layer.scrollLeft=layer.scrollWidth;return {samePane:document.querySelector('[data-leaf-id="integration-leaf"]')===window.__originalChatPane,paths:[...document.querySelectorAll('.ac-branch')].map(e=>e.dataset.tip)}})()`)
  check(splitState.samePane&&splitState.paths.some(p=>p.endsWith('.worktrees/main'))&&splitState.paths.some(p=>p.endsWith('.worktrees/peer')),'分屏保留聊天 DOM，并使用各自 Worktree 路径',splitState)
  await waitFor(()=>cdp.eval(`(()=>{const nav=document.querySelector('.ac-question-nav'),layer=document.querySelector('.pane-layer').getBoundingClientRect();return !nav || nav.getBoundingClientRect().left>=layer.left})()`),{timeout:8000,desc:'横向分屏导航不越过侧栏'})
  await shot('integration-split-worktrees')
  check(cdp.consoleErrors.length===0, '渲染控制台无异常', cdp.consoleErrors)
  fs.writeFileSync(path.join(out,'integration.json'),JSON.stringify({boundary:'真实 Electron UI；安装/登录/start/事件使用可还原模拟 transport，无真实安装/认证/远端推理',checks,count,setupCalls:await cdp.eval(`window.__agentChatTestSetupCalls()`),consoleErrors:cdp.consoleErrors},null,2)+'\n')
  console.log('[integration]',checks.length,'checks passed')
}
