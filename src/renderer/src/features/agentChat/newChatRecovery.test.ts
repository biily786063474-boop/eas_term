import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
test('actual new-chat handler clears a previously recovered draft',async()=>{
 const source=ts.createSourceFile('view.tsx',fs.readFileSync(new URL('./AgentChatView.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let declaration:ts.VariableDeclaration|undefined
 const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='handleNewChat')declaration=n;ts.forEachChild(n,walk)};walk(source)
 assert.ok(declaration)
 let recovered:unknown={text:'OLD QUESTION',id:1}
 const noop=()=>{}, controller={snapshot:()=>({items:[],sendingId:null}),dispose:noop}
 const env:any={nodeRef:'f|n',messageQueueRef:{current:{controller}},switchingRef:{current:false},view:{busy:false},restored:{turns:[]},sentMessages:[],EMPTY_VIEW:{},mergeUserMessages:()=>({turns:[]}),trimForSave:(v:unknown)=>v,latestSaveRef:{current:null},pendingSaveRef:{current:null},histKey:'n',savedResumeId:null,savedResumeCli:null,cwd:'/fixture',leafId:'l',aliveRef:{current:true},reducerRef:{current:{view:()=>({busy:false})}},queuedEntriesRef:{current:new Map()},sessionId:'s',window:{api:{agentChat:{stop:noop}}},unsubRef:{current:null},tabId:'t',useStore:{getState:()=>({startNewChat:noop})},createChatReducer:()=>({}),adoptedRef:{current:true},setRecoveredDraft:(v:unknown)=>{recovered=v}}
 for(const name of ['setArchiveError','setHistoryOpen','setAgentSessionId','setAgentResumeId','setBranchOverlap','setSessionId','setView','setRestored','setSentMessages','setSendError','setText'])env[name]=noop
 const js=ts.transpileModule('const '+declaration.getText(source)+';handleNewChat',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 await runInNewContext(js,env)()
 assert.equal(recovered,undefined)
})
