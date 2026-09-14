import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historySummary, historyMatches } from './historyCatalog.ts'
test('catalog searches body without returning body in summary', () => {
 const raw = { cwd: '/project', moduleId: 'node-a', pinned: true, turns: [{ role: 'user', text: '开头' }, { role: 'assistant', text: '深处的内容' }], savedAt: 8 }
 assert.equal(historyMatches(raw, '/project', '深处'), true)
 assert.equal(historyMatches(raw, '/other', ''), false)
 assert.deepEqual(historySummary('chat-a', raw), { leafId: 'chat-a', resumeId: null, savedAt: 8, turns: 2, preview: '开头', moduleId: 'node-a', pinned: true })
})
test('old histories retain honest unknown module metadata', () => {
 assert.equal(historySummary('old', {turns: [{text:'old'}]}).moduleId, null)
 assert.equal(historyMatches({cwd:'/p',turns:[]}, '/p', ''), false)
})
