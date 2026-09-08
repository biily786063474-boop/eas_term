import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ompCanvasProof } from './builtin-cli-evidence.mjs'
test('OMP evidence matches exact native tool and fixture path without exporting unrelated payloads', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-evidence-'))
  const dir = path.join(profile, 'omp', 'agent', 'sessions', 'test')
  fs.mkdirSync(dir, { recursive:true })
  const file = '/tmp/中文 图片.png'
  fs.writeFileSync(path.join(dir,'session.jsonl'), [
    { message:{ content:[{ type:'text',text:'private message' }] } },
    { message:{ content:[{ type:'toolCall',id:'correct',name:'mcp__eas_term_canvas_open_file',arguments:{ path:file,secret:'must-not-export' } }] } },
    { message:{ content:[{ type:'toolCall',id:'wrong-path',name:'mcp__eas_term_canvas_open_file',arguments:{ path:file+'x' } }] } },
    { message:{ content:[{ type:'toolCall',id:'wrong-tool',name:'bash',arguments:{ path:file } }] } }
  ].map(JSON.stringify).join('\n') + '\n{partial')
  try {
    const result = ompCanvasProof(profile,file)
    assert.deepEqual(result, [{execId:'correct',tool:'mcp__eas_term_canvas_open_file',path:file,sessionFile:path.join('omp','agent','sessions','test','session.jsonl')}])
    assert.equal(JSON.stringify(result).includes('must-not-export'),false)
    assert.deepEqual(ompCanvasProof(profile,'/missing'),[])
    assert.deepEqual(ompCanvasProof(profile,file,'canvas_open_image'),[])
  } finally { fs.rmSync(profile,{recursive:true,force:true}) }
})
