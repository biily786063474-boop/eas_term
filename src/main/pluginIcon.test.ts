import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pluginIconData} from './pluginIcon.ts'
test('registered icon has bounded image data; missing, huge and symlink escapes fall back',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-icon-')),root=path.join(dir,'plugin');fs.mkdirSync(root)
 try{
  const icon=path.join(root,'icon.svg');fs.writeFileSync(icon,'<svg/>')
  assert.equal(pluginIconData(root,icon),'data:image/svg+xml;base64,PHN2Zy8+')
  const outer=path.join(dir,'outside.svg');fs.writeFileSync(outer,'<svg/>');const link=path.join(root,'link.svg');fs.symlinkSync(outer,link)
  assert.equal(pluginIconData(root,link),undefined)
  fs.writeFileSync(icon,'x'.repeat(131073));assert.equal(pluginIconData(root,icon),undefined)
  assert.equal(pluginIconData(root),undefined)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
