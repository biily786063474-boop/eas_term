import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isIslandLab, islandLabProfile} from './islandLabPolicy.ts'
test('Lab identity and profile never select production',()=>{
 assert.equal(isIslandLab('Eas-Term'),false)
 assert.equal(isIslandLab('Eas-Term Island Lab'),true)
 assert.equal(islandLabProfile('/data'),'\/data/Eas-Term Island Lab')
})
test('Lab overrides inherited CLI paths and removes inherited service secrets',async()=>{
 const {labEnvironment}=await import('./islandLabPolicy.ts')
 const result=labEnvironment({CODEX_HOME:'/real',DSH_HOME:'/real-dsh',CLAUDE_CONFIG_DIR:'/real-claude',OPENAI_API_KEY:'fixture',EAS_TERM_TOKEN:'fixture',PATH:'/usr/bin',ZDOTDIR:'/real-shell',BASH_ENV:'/real-shell/start'},'/lab/home')
 assert.equal(result.CODEX_HOME,'/lab/home/.codex');assert.equal(result.DSH_HOME,'/lab/home/.dsh')
 assert.equal(result.CLAUDE_CONFIG_DIR,'/lab/home/.claude');assert.equal(result.OPENAI_API_KEY,undefined)
 assert.equal(result.ZDOTDIR,'/lab/home');assert.equal(result.BASH_ENV,undefined);assert.equal(result.EAS_TERM_TOKEN,undefined);assert.equal(result.PATH,'/usr/bin')
})
test('Lab main environment preserves the system keychain HOME',async()=>{
 const {labEnvironment}=await import('./islandLabPolicy.ts')
 assert.equal(labEnvironment({HOME:'/system-user'},'/lab/home').HOME,'/system-user')
})
test('Lab bootstrap creates CLI roots without replacing existing configuration',async()=>{
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path')
 const policy=await import('./islandLabPolicy.ts')
 assert.equal(typeof policy.initializeLabHome,'function')
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'island-home-test-'))
 try{
  policy.initializeLabHome(home)
  for(const name of ['.codex','.claude','.dsh','.omp','.config','.cache','.local/state','.local/share'])assert.ok(fs.statSync(path.join(home,name)).isDirectory(),name)
  const sentinel=path.join(home,'.codex','config.toml');fs.writeFileSync(sentinel,'fixture = true\n')
  policy.initializeLabHome(home)
  assert.equal(fs.readFileSync(sentinel,'utf8'),'fixture = true\n')
 }finally{fs.rmSync(home,{recursive:true,force:true})}
})
