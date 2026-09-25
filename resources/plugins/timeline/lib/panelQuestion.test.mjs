import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const html=fs.readFileSync(new URL('../ui/panel.html',import.meta.url),'utf8')
test('timeline detail and candidate reveal original user question with textContent',()=>{
 assert.match(html,/id="taskOriginalQuestion"/)
 assert.match(html,/用户初始问题/)
 assert.match(html,/\$\('#taskOriginalQuestion'\)\.textContent=r\.originalQuestion\|\|'未记录'/)
 assert.match(html,/c\.originalQuestion/)
 assert.doesNotMatch(html,/innerHTML\s*=\s*c\.originalQuestion/)
})
