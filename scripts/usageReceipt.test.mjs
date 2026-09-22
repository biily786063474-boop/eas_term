import test from 'node:test'
import assert from 'node:assert/strict'
import { reportRange, receiptContent, receiptSvg } from '../src/renderer/src/features/canvas/receiptReport.ts'
import { queryLedger } from '../src/main/usage/storage.ts'
test('calendar week starts Monday, month starts first day; end is frozen now',()=>{
 const now=new Date(2026,8,27,15,30)
 assert.equal(reportRange('week',now).from,new Date(2026,8,21).getTime())
 assert.equal(reportRange('month',now).from,new Date(2026,8,1).getTime())
 assert.equal(reportRange('week',now).to,now.getTime()+1)
 assert.equal(reportRange('week',new Date(2026,0,1)).from,new Date(2025,11,29).getTime())
})
test('unknown costs are never zero; receipt escapes names and excludes paths',()=>{
 const range={from:1,to:200}
 const data=queryLedger({version:1,since:50,rows:[{id:'1',session:'secret-session',project:'/private/secret',projectName:'<script>&',cli:'codex',model:'m',startedAt:100,status:'completed',meter:{input:100,output:20,cacheRead:80}}]},range)
 const content=receiptContent('week',range,data)
 assert.match(content.text,/120/)
 assert.match(content.text,/未知/)
 assert.match(content.text,/不完整/)
 assert.doesNotMatch(content.text,/private|secret-session/)
 const svg=receiptSvg(content)
 assert.match(svg,/&lt;script&gt;&amp;/)
 assert.doesNotMatch(svg,/<script>/)
})
