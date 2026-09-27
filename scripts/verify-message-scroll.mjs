import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {setTimeout as sleep} from 'node:timers/promises'
export async function verifyMessageScroll(cdp,projectDir,root,waitFor){
 const sid='scroll-fixture'
 const tabs=[{id:'scroll-tab',title:'消息定位验收',projectId:null,cwd:projectDir,activeLeafId:sid,root:{type:'leaf',id:sid,pane:{kind:'agent',cli:'codex',cwd:projectDir,sessionId:sid}}}]
 await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:'+JSON.stringify(tabs)+',activeTabId:"scroll-tab",canvas:{...s.canvas,frames:[{id:"scroll-frame",projectId:null,name:"消息定位验收",x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:"scroll-node",leafId:"scroll-fixture",x:20,y:50,w:850,h:680}]}]}});window.__store.getState().setMaximizedNode({frameId:"scroll-frame",nodeId:"scroll-node"})})()')
 await waitFor(()=>cdp.eval('!!document.querySelector(".ac-toolbar")'),{timeout:12000,desc:'toolbar'})
 const push=e=>cdp.eval('window.__agentChatTestPush('+JSON.stringify(sid)+','+JSON.stringify(e)+')')
 await push({k:'turn.start'})
 await push({k:'text.done',text:Array.from({length:50},(_,i)=>'第 '+i+' 段：消息滚动验收。').join('\n\n')})
 await push({k:'turn.done'})
 const pos=()=>cdp.eval('(()=>{const e=document.querySelector(".ac-messages");return {top:e.scrollTop,gap:e.scrollHeight-e.clientHeight-e.scrollTop}})()')
 await sleep(500);assert.ok((await pos()).gap<2,'initial latest')
 await cdp.eval('document.querySelector(".ac-turn").style.paddingBottom="500px"')
 await sleep(300);assert.ok((await pos()).gap<2,'late geometry follows')
 await cdp.eval('document.querySelector(".ac-messages").scrollTop=100')
 await sleep(100);const before=await pos()
 await push({k:'turn.start'});await push({k:'text.done',text:'最新消息，不打断阅读历史。'});await push({k:'turn.done'})
 await sleep(300);assert.ok(Math.abs((await pos()).top-before.top)<2,'manual history preserved')
 await cdp.clickElement('document.querySelector(".ac-jump")','回到最新')
 await sleep(300);assert.ok((await pos()).gap<2,'jump latest')
 await push({k:'turn.start'})
 await push({k:'text.done',text:'建议下一步（推荐第一个）\n1. 补跑复审 —— 查看验证结果\n2. 先看界面 —— 查看交互效果'})
 await sleep(150)
 await push({k:'exec.start',execId:'options-tool',kind:'tool',label:'检查',detail:'{}'})
 await push({k:'exec.done',execId:'options-tool',ok:true,output:''})
 await push({k:'text.done',text:'选项之后到达的最终补充说明。'})
 await push({k:'turn.done'})
 await sleep(250)
 assert.ok(await cdp.eval(`(()=>{const opts=[...document.querySelectorAll('.ac-opts')].at(-1);const text=[...document.querySelectorAll('.ac-turn-text')].find(e=>e.textContent.includes('选项之后到达的最终补充说明'));return !!opts&&!!text&&!!(text.compareDocumentPosition(opts)&Node.DOCUMENT_POSITION_FOLLOWING)})()`),'options follow late reply text')
 const out=path.join(root,'docs/verification/message-scroll');fs.mkdirSync(out,{recursive:true})
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'latest.png'),Buffer.from(shot.result.data,'base64'))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['initial latest','late geometry','manual history','jump latest','options follow late text'],scope:'real Electron UI with protocol fixtures; refresh persistence not yet covered'},null,2))
}
