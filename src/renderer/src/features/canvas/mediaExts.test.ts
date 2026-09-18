import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImagePath, isVideoPath, isAudioPath, isModelPath, isMediaPath } from './mediaExts.ts'

test('各类媒体各自认得出来', () => {
  assert.ok(isImagePath('/a/b.PNG'), '扩展名要不分大小写')
  assert.ok(isVideoPath('/a/b.mov'))
  assert.ok(isAudioPath('/a/b.m4a'))
  assert.ok(isModelPath('/a/b.GLB'), '3D 模型扩展名也不分大小写')
})

test('3D 首版只收 .glb，不收 .gltf/.obj', () => {
  assert.ok(isModelPath('scene.glb'))
  assert.equal(isModelPath('scene.gltf'), false)
  assert.equal(isModelPath('scene.obj'), false)
})

test('isMediaPath 覆盖四类，不含文档', () => {
  for (const p of ['x.jpg', 'x.mp4', 'x.wav', 'x.flac', 'x.glb']) assert.ok(isMediaPath(p), p)
  for (const p of ['x.md', 'x.ts', 'x.html', 'x.pdf', 'x']) assert.equal(isMediaPath(p), false, p)
})

test('没有扩展名 / 只有点不会误判成媒体', () => {
  assert.equal(isMediaPath('README'), false)
  // 「.mp3」这种隐藏文件名本身就是扩展名的情况——判成音频是对的，不算误判
  assert.ok(isMediaPath('.mp3'))
})

test('3D 分类与可预览媒体独立，保留新版 GLB 预览', async () => {
  const m = await import('./mediaExts.ts')
  assert.equal(typeof m.is3DPath, 'function')
  for (const p of ['模型.GLB', 'x.gltf', 'x.obj', 'x.fbx', 'x.stl', 'C:\\模型\\X.OBJ'])
    assert.equal(m.is3DPath(p), true, p)
  for (const p of ['x.png', 'x.mp4', 'x.mtl', 'x.bin', 'README', '/x.obj/readme'])
    assert.equal(m.is3DPath(p), false, p)
  assert.equal(isMediaPath('model.glb'), true)
  assert.equal(isMediaPath('model.obj'), false)
})
