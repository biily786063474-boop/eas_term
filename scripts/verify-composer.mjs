import fs from 'node:fs'
import path from 'node:path'

// Actual React components and DOM events; start/send and faulted sources use the existing isolated fixture bridge.
export async function verifyComposer({cdp,projectDir,root,waitFor}) {
  const out=path.join(root,'docs/verification/composer')
  fs.mkdirSync(out,{recursive:true})
  const checks=[]
  const assert=async (expression,name)=>{const data=await cdp.eval(expression);if(!data){const diagnostic=await cdp.eval('(()=>{const row=document.querySelector(".ac-mentions-row.on"),list=document.querySelector(".ac-mentions-results");return {viewport:[innerWidth,innerHeight],send:document.querySelector("[aria-label=发送消息]")?.getBoundingClientRect().toJSON(),pane:document.querySelector(".agent-chat-view")?.getBoundingClientRect().toJSON(),row:row?.getBoundingClientRect().toJSON(),list:list?.getBoundingClientRect().toJSON(),index:row?.dataset.index,scroll:list?.scrollTop,focus:document.activeElement?.outerHTML.slice(0,200)}})()');throw new Error(name+": "+JSON.stringify(diagnostic));}checks.push(name);console.log('[composer] ✓',name)}
  const ready=async expression=>{
    try { return await waitFor(()=>cdp.eval(expression),{timeout:12000,desc:expression}) }
    catch(error) {
      const state=await cdp.eval('(()=>{const e=document.querySelector("textarea.ac-input,textarea.ac-composer");return {pane:document.querySelector(".agent-chat-view")?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],max:window.__store.getState().maximizedNode,input:e?.outerHTML,caret:e?.selectionStart,focus:document.activeElement?.outerHTML.slice(0,300),popup:document.querySelector(".ac-mentions")?.innerText,setup:document.querySelector(".ac-setup-card")?.innerText}})()')
      throw new Error(error.message+'; state='+JSON.stringify(state)+'; console='+JSON.stringify(cdp.consoleErrors))
    }
  }
  const key=async (key,modifiers=0)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers,windowsVirtualKeyCode:{Enter:13,Escape:27,ArrowDown:40,ArrowUp:38,Tab:9}[key]});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers})}
  const type=async(text,caret=text.length)=>{
    await cdp.eval('(()=>{const e=document.querySelector("textarea.ac-input,textarea.ac-composer");e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()')
    await cdp.eval('(()=>{const e=document.querySelector("textarea.ac-input,textarea.ac-composer");e.focus();e.setSelectionRange('+caret+','+caret+');e.dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowLeft",bubbles:true}));})()')
  }

  const caps={contextUsage:true,approval:[],models:[{id:'test-model',label:'Test model'}],effortLevels:[{id:'low',label:'低'},{id:'high',label:'高'}],compact:'slash'}
  const clis=['codex','claude','omp'].map(id=>({id,displayName:id,available:true,chatSupported:true,capabilities:{...caps,...(id==='claude'?{nativeSlash:[{name:'context',description:'查看上下文'}]}:{})}}))
  await cdp.eval('window.__agentChatTestSetup('+JSON.stringify({clis})+')')
  await cdp.eval('window.__composerTestSetup({})')
  const faultsOnly=process.argv.includes('--faults-only')
  for(const cli of (faultsOnly?['omp']:['codex','claude','omp'])) for(const stage of (faultsOnly?['active']:['startup','active'])) {
    const sid='composer-'+cli+'-'+stage
    const pane={kind:'agent',cwd:projectDir,cli,...(stage==='active'?{sessionId:sid}:{})}
    await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:[{id:"composer-tab",title:"输入框回归",cwd:'+JSON.stringify(projectDir)+',activeLeafId:'+JSON.stringify(sid)+',root:{type:"leaf",id:'+JSON.stringify(sid)+',pane:'+JSON.stringify(pane)+'}}],activeTabId:"composer-tab",canvas:{...s.canvas,frames:[{id:"composer-frame",name:"输入框回归",projectId:null,x:0,y:0,w:1000,h:800,collapsed:false,nodes:[{id:"composer-node",leafId:'+JSON.stringify(sid)+',x:40,y:60,w:850,h:700}]}]}});s.setMaximizedNode({frameId:"composer-frame",nodeId:"composer-node"})})()')
    await ready(stage==='active'?'!!document.querySelector("textarea.ac-composer")':'!!document.querySelector("textarea.ac-input")')
    if(stage==='startup') await ready('!!document.querySelector("[aria-label=启动模型]") && !document.querySelector(".ac-setup-card")')
    if(stage==='active') {
      for(const event of [{k:'session.ready',sessionId:sid,model:'test-model',cwd:projectDir},{k:'turn.done',usage:{inputTokens:1,outputTokens:1}}])await cdp.eval('window.__agentChatTestPush('+JSON.stringify(sid)+','+JSON.stringify(event)+')')
    }
    await cdp.eval('window.__store.getState().setMaximizedNode({frameId:"composer-frame",nodeId:"composer-node"})')
    await ready('(()=>{const r=document.querySelector(".agent-chat-view").getBoundingClientRect();return r.left>=-4&&r.top>=0&&r.bottom<=innerHeight})()')
    await type('@debounce')
    await ready('document.querySelector(".ac-mentions")?.innerText.includes("防抖")')
    await assert('document.querySelectorAll(".ac-mentions nav button").length===8',cli+' '+stage+' 八分类和真实辞典数据')
    await cdp.clickElement('[...document.querySelectorAll(".ac-mentions-foot button")].find(e=>e.textContent==="预览词条")','预览辞典')
    await assert('document.querySelector(".ac-mentions-detail p").textContent.length>40',cli+' '+stage+' 完整词条预览')
    await key('Enter')
    await ready('document.querySelector("textarea.ac-input,textarea.ac-composer").value.includes("@防抖")')
    await assert('document.querySelector(".ac-chip-state")?.textContent==="本次引用"',cli+' '+stage+' 选择加载 chip 并插入引用')
    await cdp.clickElement('[...document.querySelectorAll(".ac-composer-extras button")].find(e=>e.textContent==="发送内容预览")','发送预览')
    await ready('!!document.querySelector(".ac-send-preview pre")')
    await assert('document.querySelector(".ac-send-preview pre").textContent.length>50 && !document.querySelector(".ac-send-preview pre").textContent.includes("@防抖")',cli+' '+stage+' 预览为展开全文')
    await type('未引用的消息')
    await assert('document.querySelector(".ac-chip-state").textContent==="备选" && document.querySelector(".ac-composer-shortcuts").textContent.includes("将附带全部")',cli+' '+stage+' 未引用保留旧附带语义且文案正确')
    await type('请看 @debounce 后缀',12)
    await ready('document.querySelector(".ac-mentions")?.innerText.includes("防抖")')
    await key('Tab')
    await assert('document.querySelector("textarea.ac-input,textarea.ac-composer").value==="请看 @防抖 后缀"',cli+' '+stage+' 光标处替换保留后缀')
    await type('a@b.com')
    await assert('!document.querySelector(".ac-mentions")',cli+' '+stage+' 邮箱不触发')
    await type('@')
    await ready('!!document.querySelector(".ac-mentions")')
    await key('Escape')
    await assert('!document.querySelector(".ac-mentions")',cli+' '+stage+' Escape 关闭')
    await assert('window.__store.getState().maximizedNode?.nodeId==="composer-node"',cli+' '+stage+' 关闭候选不退出画布最大化')
    await key('Escape')
    await assert('window.__store.getState().maximizedNode===null',cli+' '+stage+' 无候选时 Escape 仍退出最大化')
    await cdp.eval('window.__store.getState().setMaximizedNode({frameId:"composer-frame",nodeId:"composer-node"})')
    await type('@no-such-candidate-987654321')
    await ready('document.querySelector(".ac-mentions")?.innerText.includes("没有匹配结果")')
    await assert('document.querySelector("textarea.ac-input,textarea.ac-composer").getAttribute("aria-expanded")==="true"',cli+' '+stage+' 空结果仍显示面板')
    await type('@file')
    await ready('!!document.querySelector(".ac-mentions")')
    await cdp.clickElement('[...document.querySelectorAll(".ac-mentions nav button")].find(e=>e.textContent==="文件")','文件分类')
    await ready('document.querySelectorAll(".ac-mentions-row").length===35')
    for(let i=0;i<12;i++)await key('ArrowDown')
    await assert('(()=>{const row=document.querySelector(".ac-mentions-row.on").getBoundingClientRect(),list=document.querySelector(".ac-mentions-results").getBoundingClientRect();return row.top>=list.top-1 && row.bottom<=list.bottom+1})()',cli+' '+stage+' 第十三项键盘选中仍可见')
    await cdp.eval('(()=>{const e=document.querySelector("textarea.ac-input,textarea.ac-composer");window.__composerBefore=e.value;e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,isComposing:true}));})()')
    await assert('document.querySelector("textarea.ac-input,textarea.ac-composer").value===window.__composerBefore',cli+' '+stage+' IME 确认不插入不发送')
    for(const theme of ['light','dark']) {
      await cdp.eval('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.querySelector(".agent-chat-view").style.width="640px"')
      await ready('(()=>{const r=document.querySelector(".ac-mentions")?.getBoundingClientRect();return r&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()')
      await assert('(()=>{const r=document.querySelector("[aria-label=发送消息]").getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()',cli+' '+stage+' '+theme+' 预览展开时发送按钮仍在视口内')
      const shot=await cdp.send('Page.captureScreenshot',{format:'png'})
      fs.writeFileSync(path.join(out,cli+'-'+stage+'-'+theme+'.png'),Buffer.from(shot.result.data,'base64'))
    }
    await type('/')
    await ready('document.querySelector(".ac-mentions")?.innerText.includes("命令与技能")')
    await assert('document.querySelector(".ac-mentions").innerText.includes("当前端口命令")==='+JSON.stringify(cli==='claude'),cli+' '+stage+' 仅显示 adapter 声明的原生命令')
    await type('/model')
    await ready('document.querySelector(".ac-mentions")?.innerText.includes("model")')
    await key('Enter')
    await assert('document.querySelector("textarea.ac-input,textarea.ac-composer").value==="/model "',cli+' '+stage+' 斜杠先填入不发送')
    await key('Enter',4)
    await assert('["启动模型","对话模型"].includes(document.activeElement.getAttribute("aria-label"))',cli+' '+stage+' 发送通用命令聚焦既有控件')
    if(stage==='active') {
      await cdp.eval('window.__composerTestSetup({sendFail:true})')
      await type('按照 @防抖 完成')
      await key('Enter',4)
      await ready('document.querySelector("textarea.ac-composer").value==="按照 @防抖 完成"')
      await assert('document.querySelector(".ac-chip")?.textContent.includes("防抖") && window.__composerTestSends().at(-1).message.length>50',cli+' 失败恢复草稿与辞典，传输收到全文')
      await cdp.eval('window.__composerTestSetup({sendFail:false})')
      await key('Enter',4)
      await ready('document.querySelector("textarea.ac-composer").value===""')
      await assert('!document.querySelector(".ac-chip")',cli+' 成功发送仅清理已用词条')
    }
    await cdp.eval('document.querySelector(".agent-chat-view").style.width=""')
  }
  await cdp.eval('window.__composerTestSetup({filesError:true,userDictError:true,filesDelay:900})')
  await type('@')
  await ready('document.querySelector(".ac-mentions")?.innerText.includes("读取失败")')
  await assert('document.querySelector(".ac-mentions").innerText.includes("全部辞典")','文件和用户辞典读取失败不影响内置辞典')
  const retryRect=await cdp.eval('(()=>{const b=[...document.querySelectorAll(".ac-mentions button")].find(e=>e.textContent==="重试");const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...retryRect})
  await ready('document.querySelector(".ac-mentions-status").textContent.includes("项目文件")')
  await assert('(()=>{const b=[...document.querySelectorAll(".ac-mentions button")].find(e=>e.textContent==="重试"),r=b.getBoundingClientRect();return Math.abs(r.left+r.width/2-'+retryRect.x+')<1 && Math.abs(r.top+r.height/2-'+retryRect.y+')<1})()','多个来源完成时重试按钮在按下和松开之间不移位')
  await cdp.eval('window.__composerTestSetup({filesError:false,filesDelay:300})')
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...retryRect})
  await waitFor(async()=>{const status=await cdp.eval('[...document.querySelectorAll(".ac-mentions-status")].map(e=>e.textContent)');if(status.length)throw new Error(JSON.stringify(status));return true},{timeout:12000,desc:'重试后所有来源完成'})
  await type('@file')
    await ready('!!document.querySelector(".ac-mentions")')
    await cdp.clickElement('[...document.querySelectorAll(".ac-mentions nav button")].find(e=>e.textContent==="文件")','文件分类')
  await ready('document.querySelectorAll(".ac-mentions-row").length===35')
  await assert('true','重试恢复候选')
  await cdp.eval('document.querySelector("textarea.ac-composer").blur()')
  await assert('!document.querySelector(".ac-mentions")','失焦关闭 portal 不泄漏到其他面板')
  const rawUser={id:'debounce',zh:'',en:'Legacy term',keywords:[],logic:'legacy explanation',prompt:'legacy prompt',category:'interaction',svg:'',firstSeen:'',project:''}
  await cdp.eval('window.__composerTestSetup('+JSON.stringify({userTerms:[rawUser]})+')')
  await type('')
  await cdp.eval('window.__store.getState().composerAddChip({id:"user:debounce",label:"Legacy term",text:"preloaded legacy prompt"})')
  await type('@Legacy')
  await ready('document.querySelectorAll(".ac-mentions-row").length===1 && document.querySelector(".ac-mentions").innerText.includes("Legacy term")')
  await key('Enter')
  await assert('document.querySelectorAll(".ac-chip").length===1 && document.querySelector("textarea.ac-composer").value==="@Legacy term "','自建词条沿用辞典预加载身份且英文名正常插入')
  await type('@Legacy term 参考 @src/file.ts')
  if(!await cdp.eval('!!document.querySelector(".ac-send-preview")')) await cdp.clickElement('[...document.querySelectorAll(".ac-composer-extras button")].find(e=>e.textContent==="发送内容预览")','自建词条发送预览')
  await ready('document.querySelector(".ac-send-preview pre")?.textContent==="preloaded legacy prompt 参考 @src/file.ts"')
  await assert('true','自建词条不会向文件引用误展开提示词')
  if(cdp.consoleErrors.length)throw new Error(cdp.consoleErrors.join('\n'))
  fs.writeFileSync(path.join(out,faultsOnly?'faults-results.json':'results.json'),JSON.stringify({boundary:'真实 Electron/React/字典数据；发送与文件故障使用测试夹具，无真实推理',checks},null,2)+'\n')
  console.log('[composer]',checks.length,'checks passed')
}
