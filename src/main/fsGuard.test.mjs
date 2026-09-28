import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
const source = fs.readFileSync(new URL('./fsGuard.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(io, paths, platform, profile = '/profile') {
  const exports = {}
  new Function('exports','fs','path','app','wikiPath','process',js)(exports,io,paths,{getPath:()=>profile},()=>null,{platform})
  return exports
}
test('Windows short and long paths identify one authorized root without allowing junction escape', () => {
  const short = 'C:\\Users\\RUNNER~1\\project', long = 'C:\\Users\\runneradmin\\project'
  const actual = new Map([[short,long],[long,long],[short+'\\escape','C:\\outside'],['C:\\outside','C:\\outside']])
  const realpathSync = p => { if(!actual.has(p)) throw Error('missing'); return p===short+'\\escape'?'C:\\outside':p }
  realpathSync.native = p => { if(!actual.has(p)) throw Error('missing'); return actual.get(p) }
  const guard=load({realpathSync,readFileSync:()=>JSON.stringify([{path:short}])},path.win32,'win32')
  assert.equal(guard.realResolve(short),long)
  assert.equal(guard.guardDir(long).ok,true)
  assert.equal(guard.guardDir(short).ok,true)
  assert.equal(guard.guardDir(short+'\\new\\child').ok,true)
  assert.equal(guard.guardDir(short+'\\escape').ok,false)
  assert.equal(guard.guardDir(long+'-other').ok,false)
  assert.equal(guard.guardPath(short).ok,false)
})
test('real filesystem still rejects sibling and symlink escape, permits a new child', {skip:process.platform==='win32'}, () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-fsguard-'))
  try {
    const root=path.join(dir,'project'), outside=path.join(dir,'outside')
    fs.mkdirSync(root);fs.mkdirSync(outside)
    fs.writeFileSync(path.join(dir,'projects.json'),JSON.stringify([{path:root}]))
    fs.symlinkSync(outside,path.join(root,'escape'),'dir')
    const guard=load(fs,path,process.platform,dir)
    assert.equal(guard.guardDir(root).ok,true)
    assert.equal(guard.guardPath(root).ok,false)
    assert.equal(guard.guardDir(path.join(root,'new','child')).ok,true)
    assert.equal(guard.guardDir(outside).ok,false)
    assert.equal(guard.guardDir(path.join(root,'escape','new')).ok,false)
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
test('image vault only accepts digest filenames and rejects directory/file symlinks', {skip:process.platform==='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-image-guard-'))
 try{
  const guard=load(fs,path,process.platform,dir),name='a'.repeat(64)+'.png'
  assert.equal(guard.guardChatImageFile(name).ok,true)
  assert.equal(guard.guardChatImageFile('a'.repeat(64)+'/png').ok,false)
  assert.equal(guard.guardChatImageFile('../'+name).ok,false)
  const outside=path.join(dir,'other'),vault=path.join(dir,'chat-images')
  fs.mkdirSync(outside);fs.symlinkSync(outside,vault,'dir')
  assert.equal(guard.guardChatImageFile(name).ok,false)
  fs.unlinkSync(vault);fs.mkdirSync(vault)
  fs.writeFileSync(path.join(outside,'file'),'fixture');fs.symlinkSync(path.join(outside,'file'),path.join(vault,name))
  assert.equal(guard.guardChatImageFile(name).ok,false)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
