import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {replacePluginDirectory} from './pluginReplace.ts'
function fixture(t:{after:(fn:()=>void)=>void}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-replace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const stage=path.join(root,'stage'),target=path.join(root,'installed');fs.mkdirSync(stage);fs.mkdirSync(target);fs.writeFileSync(path.join(stage,'new'),'new');fs.writeFileSync(path.join(target,'old'),'old');return {root,stage,target}}
test('failed preparation preserves old installation',t=>{
 const f=fixture(t)
 assert.throws(()=>replacePluginDirectory(f.stage,f.target,{...fs,cpSync:()=>{throw Error('disk full')}}))
 assert.equal(fs.readFileSync(path.join(f.target,'old'),'utf8'),'old')
})
test('failed promotion restores previous installation',t=>{
 const f=fixture(t)
 assert.throws(()=>replacePluginDirectory(f.stage,f.target,{...fs,renameSync:(from,to)=>{if(String(from).includes('.incoming-'))throw Error('promotion failure');fs.renameSync(from,to)}}))
 assert.equal(fs.readFileSync(path.join(f.target,'old'),'utf8'),'old')
 assert.deepEqual(fs.readdirSync(f.root).sort(),['installed','stage'])
})
test('successful update promotes complete new tree and removes previous tree',t=>{
 const f=fixture(t);replacePluginDirectory(f.stage,f.target)
 assert.equal(fs.readFileSync(path.join(f.target,'new'),'utf8'),'new')
 assert.equal(fs.existsSync(path.join(f.target,'old')),false)
 assert.deepEqual(fs.readdirSync(f.root).sort(),['installed','stage'])
})
