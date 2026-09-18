import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createDirectoryGrant,resolveDirectoryGrant} from './directoryGrant.ts'
import {configurationEnvironment} from './configurationRuntime.ts'
import type {PluginInfo} from '../../shared/types'
test('runtime resolves native grants and rejects replaced directories and missing configuration',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-native-root-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const dir=path.join(root,'files');fs.mkdirSync(dir)
 const grant=createDirectoryGrant(dir,'read')
 const info:PluginInfo={id:'eas:files',cli:'eas',name:'files',displayName:'Files',root:'/plugin',mcp:{command:'node',args:[],env:{},cwd:'/plugin'},config:{fields:[{id:'root',type:'directory',label:'Root',purpose:'Read',required:true,access:'read'}]}}
 assert.throws(()=>configurationEnvironment(info,undefined),/配置/)
 assert.deepEqual(JSON.parse(configurationEnvironment(info,{root:grant,undeclared:'secret'})),{root:{path:fs.realpathSync(dir),access:'read'}})
 assert.throws(()=>resolveDirectoryGrant(grant,'read-write'),/授权/)
 fs.renameSync(dir,dir+'-old');fs.mkdirSync(dir)
 assert.throws(()=>configurationEnvironment(info,{root:grant}),/重新选择/)
})
