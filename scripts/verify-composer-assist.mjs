import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {setTimeout as sleep} from 'node:timers/promises'
export async function verifyComposerAssist(cdp,projectDir,root,waitFor){
 const out=path.join(root,'docs/verification/composer-assist-20260928');fs.mkdirSync(out,{recursive:true})
 const checks=[],input='document.querySelector("[data-composer-input]")'
 const ready=expr=>waitFor(()=>cdp.eval(expr),{timeout:15000,desc:expr})
 const check=async(expr,name)=>{assert.ok(await cdp.eval(expr),name+' '+JSON.stringify(await cdp.eval('(()=>{const e='+input+';return {text:e?.value,from:e?.selectionStart,to:e?.selectionEnd,focus:document.activeElement?.className}})()')));checks.push(name);console.log('[assist] ✓ '+name)}
 const key=async(key,modifiers=0)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers,windowsVirtualKeyCode:{Tab:9,ArrowUp:38,ArrowDown:40,Escape:27}[key]});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers});await sleep(80)}
 const fill=async(text)=>{
  await cdp.eval('('+input+').focus()');await sleep(30)
  await cdp.eval('('+input+').value='+JSON.stringify(text))
  await cdp.eval('(()=>{const e='+input+';e.focus();e.setSelectionRange(e.value.length,e.value.length);e.dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowRight",bubbles:true}))})()')
  await ready(input+'.value==='+JSON.stringify(text))
 }

 const shot=async(name)=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.result.data,'base64'))}
 const caps={contextUsage:true,approval:[],models:[{id:'fixture-model',label:'Fixture'}],effortLevels:[],compact:'slash'}
 await cdp.eval('window.__agentChatTestSetup('+JSON.stringify({clis:['codex','claude','omp'].map(id=>({id,displayName:id,available:true,chatSupported:true,capabilities:caps}))})+')')
 await cdp.eval('window.__composerTestSetup({})')
 const options='你选哪一个？\n1. 先看说明\n2. 开始实现（推荐）'
 async function mount(cli,stage,withHistory=true){
  const sid='assist-'+cli+'-'+stage,node=sid+'-node'
  const turns=withHistory?[{role:'user',text:'较早的提问',execs:[]},{role:'assistant',text:'之前的回答',execs:[]},{role:'user',text:'最近的提问',execs:[]},{role:'assistant',text:options,execs:[]}]:[]
  await cdp.eval('window.__store.setState({tabs:[],activeTabId:null})');await sleep(100)
  if(withHistory)assert.equal(await cdp.eval('window.api.agentChat.saveHistory('+JSON.stringify(node)+','+JSON.stringify(turns)+',"fixture-resume",'+JSON.stringify(projectDir)+','+JSON.stringify(cli)+')'),true)
  const pane={kind:'agent',cli,cwd:projectDir,...(withHistory?{resumeId:'fixture-resume',resumeCli:cli}:{}),...(stage==='active'?{sessionId:sid}:{})}
  await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:[{id:"assist-tab",title:"输入补全验收",cwd:'+JSON.stringify(projectDir)+',activeLeafId:'+JSON.stringify(sid)+',root:{type:"leaf",id:'+JSON.stringify(sid)+',pane:'+JSON.stringify(pane)+'}}],activeTabId:"assist-tab",canvas:{...s.canvas,frames:[{id:"assist-frame",name:"输入补全验收",projectId:null,x:0,y:0,w:1100,h:800,collapsed:false,nodes:[{id:'+JSON.stringify(node)+',leafId:'+JSON.stringify(sid)+',x:20,y:50,w:1040,h:710}]}]}});s.setMaximizedNode({frameId:"assist-frame",nodeId:'+JSON.stringify(node)+'})})()')
  await ready(input+'?.classList.contains('+JSON.stringify(stage==='active'?'ac-composer':'ac-input')+')')
  if(stage==='active')for(const e of [{k:'session.ready',sessionId:sid,model:'fixture-model',cwd:projectDir},{k:'turn.done'}])await cdp.eval('window.__agentChatTestPush('+JSON.stringify(sid)+','+JSON.stringify(e)+')')
  if(withHistory)await ready('!!document.querySelector(".ac-composer-ghost")')
  return sid
 }
 try{
  for(const cli of ['codex','claude','omp'])for(const stage of ['startup','active']){
   const label=cli+' '+stage,sid=await mount(cli,stage)
   await cdp.clickElement(input,'focus composer')
   const before=await cdp.eval('({start:window.__agentChatTestStartCalls().length,send:window.__composerTestSends().length})')
   await key('Tab');await ready(input+'.value==="开始实现（推荐）"')
   assert.deepEqual(await cdp.eval('({start:window.__agentChatTestStartCalls().length,send:window.__composerTestSends().length})'),before,label+' Tab must not send')
   checks.push(label+' Tab fills without any transport call')
   await check('!document.querySelector(".ac-composer-ghost")',label+' ghost disappears after fill')
   await fill('');await key('ArrowUp');await ready(input+'.value==="最近的提问"')
   await key('ArrowUp');await ready(input+'.value==="较早的提问"')
   await key('ArrowDown');await ready(input+'.value==="最近的提问"')
   await key('ArrowDown');await ready(input+'.value===""');checks.push(label+' ↑↓ history and draft restore')
   await fill('不能覆盖的草稿');await key('ArrowUp');await check(input+'.value==="不能覆盖的草稿"',label+' nonempty draft stays intact')
   await fill('第一行\n第二行');await key('ArrowUp');await check(input+'.value==="第一行\\n第二行" && '+input+'.selectionStart<7',label+' multiline arrow edits caret')
   await fill('');await key('ArrowUp');await cdp.send('Input.insertText',{text:'编辑'});await key('ArrowUp');await check(input+'.value==="最近的提问编辑"',label+' editing recalled text ends history mode')
   await fill('');await cdp.eval(input+'.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",isComposing:true,bubbles:true,cancelable:true}))');await check(input+'.value===""',label+' IME Tab does not complete')
   await cdp.eval(input+'.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",keyCode:229,bubbles:true,cancelable:true}))');await check(input+'.value===""',label+' IME legacy event does not recall')
   await key('Tab',8);await check(input+'.value===""',label+' Shift Tab does not complete')
   await fill('@debounce');await ready('document.querySelector(".ac-mentions-row.on")?.textContent.includes("防抖")');await key('Tab');await check(input+'.value.includes("@防抖")',label+' mention menu keeps Tab priority')
   await fill('');await key('Escape');await cdp.eval('window.__store.getState().setMaximizedNode({frameId:"assist-frame",nodeId:'+JSON.stringify(sid+'-node')+'})');await cdp.clickElement(input,'refocus')
   if(cli==='codex'&&stage==='active'){
    await shot('dark-active')
    await cdp.eval('window.__store.getState().setTheme("light")');await sleep(150);await shot('light-active')
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:640,height:800,deviceScaleFactor:1,mobile:false});await sleep(200)
    await cdp.eval('(()=>{const s=window.__store.getState();s.setMaximizedNode(null);window.__store.setState({canvas:{...s.canvas,viewport:{x:0,y:0,scale:1},frames:s.canvas.frames.map(f=>({...f,x:0,y:0,w:620,h:720,nodes:f.nodes.map(n=>({...n,x:12,y:50,w:590,h:620}))}))}});window.dispatchEvent(new Event("resize"))})()');await sleep(300)
    await check('(()=>{const r=document.querySelector(".ac-composer-box").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()',label+' narrow screen hint fits')
    await shot('light-narrow');await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.eval('window.__store.getState().setTheme("dark")')
    await cdp.eval('window.__agentChatTestPush('+JSON.stringify(sid)+',{k:"turn.start"})');await ready('!document.querySelector(".ac-composer-ghost")');checks.push('busy hides recommendation')
   }
   if(cli==='codex'&&stage==='startup')await shot('startup-restored')
  }
  await mount('codex','new-conversation',false);await fill('');await key('ArrowUp');await check(input+'.value==="" && !document.querySelector(".ac-composer-ghost")','new conversation has no other session history or recommendation')
  await key('Tab');await check('document.activeElement!=='+input+' && '+input+'.value===""','Tab without suggestion keeps normal focus navigation')
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,realElectron:true,fixtureTransport:true,onlineModel:false,realIME:false},null,2))
 }catch(e){await shot('failure');fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(e),input:await cdp.eval('(()=>{const e='+input+';return {text:e?.value,from:e?.selectionStart,focus:document.activeElement?.className}})()'),checks,console:cdp.consoleErrors},null,2));throw e}
}
