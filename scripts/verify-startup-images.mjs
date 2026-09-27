import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {setTimeout as sleep} from 'node:timers/promises'
export async function verifyStartupImages(cdp,projectDir,root,waitFor){
 const sid='scroll-fixture'
 const tabs=[{id:'scroll-tab',title:'消息定位验收',projectId:null,cwd:projectDir,activeLeafId:sid,root:{type:'leaf',id:sid,pane:{kind:'agent',cli:'codex',cwd:projectDir}}}]
 await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:'+JSON.stringify(tabs)+',activeTabId:"scroll-tab",canvas:{...s.canvas,frames:[{id:"scroll-frame",projectId:null,name:"消息定位验收",x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:"scroll-node",leafId:"scroll-fixture",x:20,y:50,w:850,h:680}]}]}});window.__store.getState().setMaximizedNode({frameId:"scroll-frame",nodeId:"scroll-node"})})()')
 await waitFor(()=>cdp.eval('!!document.querySelector(".ac-input")'),{timeout:12000,desc:'startup input'})
 await cdp.eval(`(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#2563eb';x.fillRect(0,0,32,32);return new Promise(resolve=>c.toBlob(b=>{const d=new DataTransfer();d.items.add(new File([b],'paste.png',{type:'image/png'}));document.querySelector('.ac-input').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));resolve(true)}))})()`)
 await waitFor(()=>cdp.eval('document.querySelector(".ac-image-chip img")?.naturalWidth>0'),{timeout:10000,desc:'startup image preview'})
 const out=path.join(root,'docs/verification/startup-images');fs.mkdirSync(out,{recursive:true})
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'pasted.png'),Buffer.from(shot.result.data,'base64'))
 await waitFor(()=>cdp.eval('!document.querySelector(".ac-input-send").disabled'),{timeout:20000,desc:'startup ready'})
 await cdp.clickElement('document.querySelector(".ac-input")','startup input')
 await cdp.send('Input.insertText',{text:'fixture-startup-fail'})
 await cdp.clickElement('document.querySelector(".ac-input-send")','intentional startup failure')
 await waitFor(()=>cdp.eval('document.querySelector(".agent-chat-view").innerText.includes("fixture: intentional startup failure")'),{timeout:10000,desc:'startup failure visible'})
 assert.ok(await cdp.eval('document.querySelector(".ac-image-chip img")?.naturalWidth>0'),'failed startup keeps image')
 await cdp.clickElement('document.querySelector(".ac-input")','clear failure marker')
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4})
 await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4})
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace'})
 await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace'})
 await cdp.clickElement('document.querySelector(".ac-input-send")','send image-only startup')
 try {
 await waitFor(()=>cdp.eval('window.__agentChatTestStartCalls().length>1'),{timeout:10000,desc:'startup transport called'})
 } catch(e) {throw new Error(String(e)+' '+await cdp.eval('document.querySelector(".agent-chat-view").innerText'))}
 const calls=await cdp.eval('window.__agentChatTestStartCalls()')
 assert.ok(calls.at(-1).message.includes('.png'),'image path reached startup transport')
 await waitFor(()=>cdp.eval('document.querySelector(".ac-turn-imgs img")?.naturalWidth>0'),{timeout:5000,desc:'first message image'})
 const history=await cdp.eval('window.api.agentChat.loadHistory("scroll-node")')
 assert.ok(history.turns.some(t=>t.images?.length),'real history includes image path')
 const savedPath=history.turns.find(t=>t.images?.length).images[0].path
 assert.ok(fs.existsSync(savedPath),'saved image survives startup')
 const finalShot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'sent.png'),Buffer.from(finalShot.result.data,'base64'))
 await cdp.eval('window.__agentChatTestPush("e2e-fake-session",{k:"turn.done"})')
 await sleep(400)
 await cdp.eval('window.__store.setState({tabs:[],activeTabId:null})')
 await sleep(200)
 await cdp.eval('window.__store.setState({tabs:'+JSON.stringify(tabs)+',activeTabId:"scroll-tab"})')
 await waitFor(()=>cdp.eval('document.querySelector(".ac-restored .ac-turn-imgs img")?.naturalWidth>0'),{timeout:10000,desc:'persisted image restored after remount'})
 const restoredShot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'restored.png'),Buffer.from(restoredShot.result.data,'base64'))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,scope:'fixture transport; real image storage and startup/history IPC',calls:calls.map(c=>({cli:c.cli,message:c.message}))},null,2))
}
