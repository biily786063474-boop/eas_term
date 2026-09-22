import test from 'node:test'
import assert from 'node:assert/strict'
import {timelineReceipt} from './timelineReceipt.ts'
import {receiptSvg} from '../canvas/receiptReport.ts'
import {routeViewMessage} from './appsProtocol.ts'
test('timeline report bridge requires handshake',()=>{
 assert.equal(routeViewMessage({jsonrpc:'2.0',id:1,method:'panel/timeline-report'},false).kind,'drop')
 assert.equal(routeViewMessage({jsonrpc:'2.0',id:1,method:'panel/timeline-report'},true).kind,'request')
})
test('outcome receipt labels and escaped title have no token or billing claims',()=>{
 const r=timelineReceipt({week:-1,from:'2026-09-14',to:'2026-09-20',total:1,statuses:{accepted:1,verified:0,pending:0},activeDays:1,projectCount:1,scope:'全部授权项目',projects:[{name:'项目',count:1}],highlights:[{title:'<script>完成',projectName:'项目',status:'accepted'}],partial:true})
 assert.match(r.text,/上周成果小票/);assert.match(r.text,/统计不完整/);assert.doesNotMatch(r.text,/Token|USD|工时/)
 const svg=receiptSvg(r);assert.match(svg,/height="960"/);assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/<script>/)
})
