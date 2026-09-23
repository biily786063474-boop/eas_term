import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CliSetupPanel,CliSetupHost} from '../../../src/renderer/src/features/agentChat/CliSetupPanel'
import {AiAssistantsSettings} from '../../../src/renderer/src/features/workspace/AiAssistantsSettings'
import '../../../src/renderer/src/styles/base.css'
import '../../../src/renderer/src/features/agentChat/agentChat.css'
function Fixture(){
 const [open,setOpen]=useState(false)
 return <main style={{padding:40}}><h1>隔离组件验收 · 不执行真实安装</h1><button id="open" onClick={()=>setOpen(true)}>模拟首次安装</button><button id="owner-close" onClick={()=>setOpen(false)}>关闭发起节点</button><textarea id="draft" defaultValue="验收草稿，不应自动发送"/>
 <section style={{maxWidth:460,padding:20}}><h2>设置 → AI 助手</h2><AiAssistantsSettings/></section>
 {open&&<CliSetupPanel cliId="codex" displayName="Codex" installCmd="DEMO-ONLY" from="install" onCancel={()=>setOpen(false)} onDone={()=>{window.fixture.done++;setOpen(false)}}/>}
 <CliSetupHost/></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
