import test from 'node:test'
import assert from 'node:assert/strict'
import { startupImageMessage } from './startupImages.ts'
test('image-only startup sends paths but displays thumbnails without path text', () => {
 const r=startupImageMessage('', [{path:'/tmp/a b.png',url:'data:image/png;base64,eA=='}])
 assert.equal(r.payload,'"/tmp/a b.png"');assert.equal(r.text,'');assert.equal(r.images.length,1)
})
test('text and images preserve order, programmatic override excludes draft attachments', () => {
 const imgs=[{path:'/tmp/a.png',url:'thumb'}]
 assert.equal(startupImageMessage('hello',imgs).payload,'/tmp/a.png hello')
 assert.deepEqual(startupImageMessage('draft',imgs,'continue'),{payload:'continue',text:'continue',images:[]})
})
