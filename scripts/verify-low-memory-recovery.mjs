import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
export async function verifyLowMemoryRecovery(cdp,projectDir,root,waitFor){
 const out=path.join(root,'docs/verification/low-memory');fs.mkdirSync(out,{recursive:true})
 const sid='unsent-fixture',payload='请检查第一次发送的原始问题。\n附件引用也应保留。'
 const tabs=[{id:'unsent-tab',title:'未发送恢复验收',cwd:projectDir,activeLeafId:sid,root:{type:'leaf',id:sid,pane:{kind:'agent',cli:'claude',cwd:projectDir,sessionId:sid}}}]
 await cdp.eval(`(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',tabs:${JSON.stringify(tabs)},activeTabId:'unsent-tab',canvas:{...s.canvas,frames:[{id:'unsent-frame',name:'低内存 · 隔离验收',projectId:null,x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:'unsent-node',leafId:${JSON.stringify(sid)},x:20,y:50,w:850,h:680}]}]}});s.setMaximizedNode({frameId:'unsent-frame',nodeId:'unsent-node'})})()`)
 await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-toolbar')`),{timeout:12000,desc:'unsent toolbar'})
 const push=e=>cdp.eval(`window.__agentChatTestPush(${JSON.stringify(sid)},${JSON.stringify(e)})`)
 await push({k:'user.message',text:payload});await push({k:'turn.start'})
 await push({k:'message.unsent',text:payload,reason:'等待资源超时，本次消息未发送。恢复草稿后可手动发送，不会自动重试。'})
 await push({k:'turn.done',usage:{inputTokens:0,outputTokens:0},usageKnown:false,interrupted:true})
 await new Promise(r=>setTimeout(r,300))
 assert.equal(await cdp.eval(`window.__store.getState().attentionPtys.includes(${JSON.stringify(sid)})`),false)
 assert.equal(await cdp.eval(`window.__store.getState().runningPtys.includes(${JSON.stringify(sid)})`),false)
 const button=`[...document.querySelectorAll('.ac-messages button')].find(b=>b.textContent==='恢复草稿')`
 await waitFor(()=>cdp.eval(`!!(${button})`),{timeout:5000,desc:'recover draft button'})
 const width=await cdp.eval(`(${button}).getBoundingClientRect().width`)
 assert.ok(width<240,'recovery must remain a compact action, not a full-width banner')
 await cdp.clickElement(`document.querySelector('.ac-toolbar [data-composer-input]')`,'existing draft')
 await cdp.send('Input.insertText',{text:'已有草稿'})
 await cdp.clickElement(button,'恢复未发送原文（不发送）')
 await waitFor(()=>cdp.eval(`document.querySelector('.ac-toolbar [data-composer-input]').textContent.includes(${JSON.stringify(payload.split('\n')[0])})`),{timeout:5000,desc:'recovered original text'})
 const text=await cdp.eval(`document.querySelector('.ac-toolbar [data-composer-input]').textContent`)
 assert.ok(text.includes('已有草稿')&&text.includes('附件引用也应保留。'))
 assert.equal(await cdp.eval('window.__agentChatTestStartCalls().length'),0)
 const metrics=await cdp.eval('window.api.runtimeMonitor(true)')
 assert.equal(metrics.processes.scope,'electron-only')
 assert.ok(metrics.processes.processCount>0)
 assert.equal(metrics.processTree.scope,'app-process-tree')
 assert.ok(metrics.processTree.residentBytes>0)
 const safe={passed:true,mode:'isolated event replay, no live model request',checks:['recover exact payload','preserve existing draft','no automatic start','opt-in aggregate IPC','interrupted cleanup clears running without completion notification'],processes:metrics.processes,totalMemoryBytes:metrics.totalMemoryBytes}
 for(const theme of ['dark','light']){
  await cdp.eval(`document.documentElement.dataset.theme='${theme}'`)
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'recovery-'+theme+'.png'),Buffer.from(shot.result.data,'base64'))
 }
 await waitFor(()=>cdp.eval(`window.api.agentChat.loadHistory('unsent-node').then(h=>h.turns.some(t=>t.unsentText===${JSON.stringify(payload)}))`),{timeout:6000,desc:'unsent payload persisted through real history IPC'})
 await cdp.eval(`(()=>{window.__unsentVerifyState=window.__store.getState();window.__store.setState({tabs:[],canvas:{...window.__store.getState().canvas,frames:[]}})})()`)
 await waitFor(()=>cdp.eval(`!document.querySelector('.agent-chat-view')`),{timeout:5000,desc:'unmounted conversation'})
 await cdp.eval(`(()=>{const s=window.__unsentVerifyState;window.__store.setState({...s,tabs:s.tabs.map(t=>({...t,root:{...t.root,pane:{...t.root.pane,sessionId:undefined}}}))});delete window.__unsentVerifyState})()`)
 await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-empty')&&!!(${button})`),{timeout:12000,desc:'history recovery after remount without live session'})
 await cdp.clickElement(button,'从历史恢复未发送原文')
 await waitFor(()=>cdp.eval(`[...document.querySelectorAll('[data-composer-input]')].some(e=>e.textContent.includes(${JSON.stringify(payload.split('\n')[0])}))`),{timeout:5000,desc:'historical payload restored into new-session composer'})
 assert.equal(await cdp.eval('window.__agentChatTestStartCalls().length'),0)
 safe.checks.push('real history IPC roundtrip','Frame unmount and recovery without live session','no automatic start after history recovery')
 // A separate fresh node exercises actual handleSend, not a user.message fixture.
 const firstTabs=[{id:'first-tab',title:'等待中首问保存',cwd:projectDir,activeLeafId:'first-leaf',root:{type:'leaf',id:'first-leaf',pane:{kind:'agent',cli:'codex',cwd:projectDir}}}]
 await cdp.eval(`(()=>{const s=window.__store.getState();window.__store.setState({tabs:${JSON.stringify(firstTabs)},activeTabId:'first-tab',canvas:{...s.canvas,frames:[{id:'first-frame',name:'首问持久化',projectId:null,x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:'first-node',leafId:'first-leaf',x:20,y:50,w:850,h:680}]}]}});s.setMaximizedNode({frameId:'first-frame',nodeId:'first-node'})})()`)
 await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-empty [data-composer-input]')`),{timeout:12000,desc:'fresh first-question composer'})
 await cdp.clickElement(`document.querySelector('.ac-empty [data-composer-input]')`,'first question before any assistant output')
 await cdp.send('Input.insertText',{text:'等待期间退出也不能丢失的初始问题'})
 await waitFor(()=>cdp.eval(`!!document.querySelector('button[aria-label="发送消息"]:not(:disabled)')`),{timeout:12000,desc:'ready for explicit first send'})
 await cdp.clickElement(`document.querySelector('button[aria-label="发送消息"]')`,'explicit first send through fake transport')
 await waitFor(()=>cdp.eval(`window.__agentChatTestStartCalls().length===1`),{timeout:12000,desc:'explicit startup accepted'})
 const firstHistory=await cdp.eval(`window.api.agentChat.loadHistory('first-node')`)
 assert.ok(firstHistory.turns.some(t=>t.role==='user'&&t.text==='等待期间退出也不能丢失的初始问题'))
 assert.equal(firstHistory.turns.filter(t=>t.role==='assistant').length,0)
 safe.checks.push('actual first-send saves original before dispatch with no assistant output')
 fs.writeFileSync(path.join(out,'recovery-result.json'),JSON.stringify(safe,null,2))
 console.log('Low-memory recovery UI PASS',safe.checks)
}
