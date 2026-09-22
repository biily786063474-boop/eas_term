import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = name => fs.readFileSync(new URL(name,import.meta.url),'utf8')
test('filters share a sticky scroll group and source action is alongside prompt',()=>{
 const view=read('./DesignPicker.tsx'),css=read('./designPicker.css')
 assert.match(view,/dsp-sticky-filters/);assert.match(css,/\.dsp-sticky-filters\{position:sticky;top:-12px/)
 assert.match(view,/dsp-use-actions/);assert.match(view,/引用源码/)
 assert.match(view,/generation !== sourceRequest.current/);assert.match(view,/composerAddChip !== destination/)
 assert.match(view,/result.path/);assert.doesNotMatch(view,/result.source/)
})
test('both composer states register project with their target callback',()=>{
 for(const file of ['AgentChatView.tsx','ChatToolbar.tsx']) {
  assert.match(read('../agentChat/'+file),/setComposerAddChip\(\(c\) => setChips\(\(cur\) => addChip\(cur, c\)\), effectiveCwd/)
 }
})
test('prompt choices appear only after trigger, then attach directly without preview',()=>{
 const view=read('./DesignPicker.tsx')
 assert.match(view,/引用提示词/);assert.match(view,/仅参考配色/);assert.match(view,/参考完整设计系统/)
 assert.match(view,/promptMenu && createPortal/)
 assert.doesNotMatch(view,/setDraft|预览提示词|dsp-scope/)
 assert.match(view,/attachPrompt\('colors'\)/);assert.match(view,/attachPrompt\('system'\)/)
})
test('portalled prompt menu belongs to dictionary, not outside-dismiss',()=>{
 assert.match(read('./DesignPicker.tsx'),/data-dict-overlay="prompt-scope"/)
 assert.match(read('../canvas/CanvasDictBubble.tsx'),/closest\('\[data-dict-overlay="prompt-scope"\]'\)/)
})
