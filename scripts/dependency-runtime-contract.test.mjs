import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const root=new URL('../',import.meta.url)
test('Windows install Node satisfies electron-rebuild >=22.12 requirement',()=>{
 const workflow=fs.readFileSync(new URL('.github/workflows/build.yml',root),'utf8')
 const installPrefix=workflow.split('- name: Install dependencies')[0]
 assert.match(installPrefix,/node-version: ['"]?24/)
})
test('Electron and rebuild versions are pinned for reproducible native ABI',()=>{
 const p=JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8'))
 for(const name of ['electron','@electron/rebuild'])assert.match(p.devDependencies[name],/^\d+\.\d+\.\d+$/)
})
