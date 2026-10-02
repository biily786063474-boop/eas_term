import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
if(process.platform!=='darwin')throw Error('Island Lab packaging requires macOS')
const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()
if(branch!=='refactor/island-native-host-20260928')throw Error('Lab build restricted to the dedicated architecture branch')
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'})
run('npm',['run','build']);run('node',['scripts/build-island-helper.mjs'])
run('node',['scripts/fetch-omp.mjs','--targets','mac-arm64'])
run('npx',['electron-builder','--config','build/island-lab.cjs','--mac','--arm64','--dir','--publish','never'])
fs.writeFileSync('release-island-lab/BUILD.json',JSON.stringify({branch,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),experimental:true,productionUpdate:false},null,2))
