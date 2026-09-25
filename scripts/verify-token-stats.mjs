import fs from 'node:fs'
import path from 'node:path'
export async function verifyTokenStats(cdp, projectDir, root, waitFor){
 const out=path.join(root,'docs/verification/token-dashboard');fs.mkdirSync(out,{recursive:true});const checks=[]
 for(const cli of ['codex','claude']){
  const sid='token-fixture-'+cli,tabs=[{id:'token-tab',title:'Token statistics verification',cwd:projectDir,activeLeafId:sid,root:{type:'leaf',id:sid,pane:{kind:'agent',cli,cwd:projectDir,sessionId:sid}}}]
  await cdp.eval(`(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',tabs:${JSON.stringify(tabs)},activeTabId:'token-tab',canvas:{...s.canvas,frames:[{id:'token-frame',name:'Token统计 · 隔离回放',projectId:null,x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:'token-node',leafId:${JSON.stringify(sid)},x:20,y:50,w:850,h:680}]}]}});s.setMaximizedNode({frameId:'token-frame',nodeId:'token-node'})})()`)
  await waitFor(()=>cdp.eval(`!!document.querySelector('.ac-toolbar')`),{timeout:12000,desc:'token toolbar'})
  const push=e=>cdp.eval(`window.__agentChatTestPush(${JSON.stringify(sid)},${JSON.stringify(e)})`)
  await push({k:'session.ready',sessionId:sid,model:'offline-fixture',cwd:projectDir});await push({k:'user.message',text:'仅回放用量，不发送模型请求'});await push({k:'turn.start'});await push({k:'text.done',text:'总输入 10000、缓存 9000：Codex 与 Claude 均应显示输入 10K、缓存命中 90%。'})
  for(const explicit of [false,true]){
   await push({k:'turn.done',usage:{inputTokens:cli==='codex'?10000:1000,cachedInputTokens:9000,outputTokens:25,...(explicit?{inputIncludesCached:cli==='codex'}:{})}})
   await waitFor(()=>cdp.eval(`document.querySelector('.ac-toolbar').textContent.includes('缓存命中 90%')&&document.querySelector('.ac-toolbar').textContent.includes('输入 10K')`),{timeout:4000,desc:cli+' cache inclusive '+explicit});checks.push(cli+' '+(explicit?'explicit':'legacy')+' input=10K cache=90%')
  }
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'stats-'+cli+'.png'),Buffer.from(shot.result.data,'base64'))
 }
 fs.writeFileSync(path.join(out,'stats-result.json'),JSON.stringify({passed:true,checks},null,2));console.log('Token stats UI',checks)
}
