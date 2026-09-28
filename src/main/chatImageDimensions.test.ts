import {test} from 'node:test'
import assert from 'node:assert/strict'
import {imageDimensions} from './chatImageDimensions.ts'
test('检查压缩文件头先于解码，拒绝超预算、截断及格式伪装',()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
 assert.deepEqual(imageDimensions(png,'image/png'),{width:1,height:1})
 png.writeUInt32BE(60000,16);png.writeUInt32BE(60000,20)
 assert.throws(()=>imageDimensions(png,'image/png'),/像素/)
 assert.throws(()=>imageDimensions(png.subarray(0,20),'image/png'))
 assert.throws(()=>imageDimensions(png,'image/jpeg'))
 const gif=Buffer.from('47494638396110002000','hex')
 assert.deepEqual(imageDimensions(gif,'image/gif'),{width:16,height:32})
})
