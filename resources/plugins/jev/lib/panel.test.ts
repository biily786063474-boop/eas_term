import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
test('decision-first panel has three navigable sections and real usage history, no key inputs',()=>{
 const html=fs.readFileSync(new URL('../ui/panel.html',import.meta.url),'utf8')
 for(const id of ['decision','automation','usage','records','material','question','preview','result','master'])assert.ok(html.includes('id="'+id+'"'),id)
 assert.doesNotMatch(html,/<input[^>]+type=["']password/)
 assert.doesNotMatch(html,/function showUsage\(\)\{[^}]*toast/)
 const script=html.match(/<script>([\s\S]*?)<\/script>/)![1];new vm.Script(script)
})
