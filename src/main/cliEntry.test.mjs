// Representative package fixtures only: these do not call models or install real CLIs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveCliInvocation, resolveNpmEntry, resolveCapabilityCli, cliInvocationEnv } from '../../mcp/cli-entry.mjs'
function fixture(t, kind = 'claude', bin = 'cli.js') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'CLI 中文 空格-'))
  t.after(() => fs.rmSync(root, {recursive:true, force:true}))
  const name = kind === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'
  const pkg = path.join(root, 'node_modules', name), shim = path.join(root, kind+'.cmd')
  fs.mkdirSync(path.dirname(path.join(pkg, bin)), {recursive:true})
  const meta = {name, version:'1.2.3', bin:{[kind]:bin}}
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify(meta))
  fs.writeFileSync(path.join(pkg,bin),'console.log(JSON.stringify(process.argv.slice(2)))')
  fs.writeFileSync(shim, '@echo MUST NEVER RUN\nexit /b 99')
  return {root,pkg,shim,meta,entry:path.join(pkg,bin)}
}
function run(command,args,env=process.env) {
  const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe'],shell:false})
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c)
  return {child,done:new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}))})}
}
const argv=['','中文 空格','a"b','&','|','^','%PATH%','!','line\nbreak']
for(const kind of ['claude']) test(`${kind} official JS bin preserves argv through real child (Windows resolution)`,async t=>{
  const f=fixture(t,kind,kind==='codex'?'bin/codex.js':'cli.js')
  const launch=resolveCliInvocation(kind,f.shim,argv,process.env,{command:process.execPath,args:[]},'win32')
  const result=await run(launch.command,launch.args,{...process.env,...launch.env}).done
  assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),argv)
})
test('native Claude npm placeholder must fail before a model can launch',t=>{
 const f=fixture(t,'claude','bin/claude.exe')
 assert.throws(()=>resolveNpmEntry('claude',f.shim),/Unsupported/)
})
test('identity, bin traversal/type and symlink escapes fail closed',t=>{
 const f=fixture(t)
 for(const change of [{name:'unrelated'},{bin:{claude:'../outside.js'}},{bin:{claude:[]}}]){
  fs.writeFileSync(path.join(f.pkg,'package.json'),JSON.stringify({...f.meta,...change}))
  assert.throws(()=>resolveNpmEntry('claude',f.shim),/Unsupported/)
 }
 fs.writeFileSync(path.join(f.pkg,'package.json'),JSON.stringify(f.meta))
 const escaped=fixture(t,'codex','bin/codex.js'),outside=path.join(escaped.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'codex.js'),'')
 fs.rmSync(path.join(escaped.pkg,'bin'),{recursive:true});fs.symlinkSync(outside,path.join(escaped.pkg,'bin'),'junction')
 assert.throws(()=>resolveNpmEntry('codex',escaped.shim),/Unsupported/)
})
test('first unsupported PATH wrapper never falls through to a second version',()=>{
 const seen=[]
 assert.throws(()=>resolveCapabilityCli('claude',{Path:'C:\\first;C:\\second',PathExt:'.CMD;.EXE'},'win32',p=>{seen.push(p);return p}),/Unsupported/)
 assert.equal(seen.length,1)
})
test('owned JS process remains cancellable without a shell process',async t=>{
 const f=fixture(t);fs.writeFileSync(f.entry,"console.log('READY');setInterval(()=>{},1000)")
 const launch=resolveCliInvocation('claude',f.shim,[],process.env,{command:process.execPath,args:[]},'win32')
 const r=run(launch.command,launch.args);await new Promise(resolve=>r.child.stdout.once('data',resolve));r.child.kill()
 const result=await r.done;assert.ok(result.signal||result.code!==0)
 assert.throws(()=>process.kill(r.child.pid,0))
})
function peFixture(arch=process.arch){
 const b=Buffer.alloc(134);b.write('MZ');b.writeUInt32LE(128,60);b.writeUInt32LE(0x4550,128);b.writeUInt16LE(arch==='arm64'?0xaa64:0x8664,132);return b
}
test('native package entries keep native execution and never acquire interpreter environment',t=>{
 const f=fixture(t,'claude','bin/claude.exe');fs.writeFileSync(f.entry,peFixture())
 const launch=resolveCliInvocation('claude',f.shim,argv,{}, {command:process.execPath,args:[],env:{ELECTRON_RUN_AS_NODE:'1'}},'win32')
 assert.equal(launch.command,fs.realpathSync(f.entry));assert.deepEqual(launch.args,argv);assert.equal(launch.env,undefined)
})
test('Codex selects only matching declared official platform alias and rejects incomplete installs',t=>{
 const f=fixture(t,'codex','bin/codex.js'),name=`@openai/codex-win32-${process.arch}`
 f.meta.optionalDependencies={[name]:`npm:@openai/codex@1.2.3-win32-${process.arch}`}
 fs.writeFileSync(path.join(f.pkg,'package.json'),JSON.stringify(f.meta))
 assert.throws(()=>resolveNpmEntry('codex',f.shim),/Unsupported/)
 const native=path.join(f.root,'node_modules',name),triple=process.arch==='arm64'?'aarch64':'x86_64'
 const bin=path.join(native,'vendor',triple+'-pc-windows-msvc','codex','codex.exe')
 fs.mkdirSync(path.dirname(bin),{recursive:true});fs.writeFileSync(bin,peFixture())
 const meta={name:'@openai/codex',version:`1.2.3-win32-${process.arch}`,os:['win32'],cpu:[process.arch]}
 fs.writeFileSync(path.join(native,'package.json'),JSON.stringify(meta))
 assert.equal(resolveNpmEntry('codex',f.shim).command,fs.realpathSync(bin))
 assert.equal(resolveNpmEntry('codex',f.shim).env.CODEX_MANAGED_PACKAGE_ROOT,fs.realpathSync(f.pkg))
 fs.writeFileSync(path.join(native,'package.json'),JSON.stringify({...meta,version:'9.9.9'}))
 assert.throws(()=>resolveNpmEntry('codex',f.shim),/Unsupported/)
})
test('Windows actual PATH case, native-only and mixed ordering follow first entry', {skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),native=path.join(f.root,'native');fs.mkdirSync(native)
 fs.copyFileSync(process.execPath,path.join(native,'claude.EXE'))
 const runner={command:process.execPath,args:[]}
 const first=resolveCliInvocation('claude','claude',[],{Path:native+';'+f.root,Pathext:'.EXE;.CMD'},runner)
 assert.equal(first.command.toLowerCase(),path.join(native,'claude.exe').toLowerCase());assert.equal(first.env,undefined)
 const nativeRun=await run(first.command,['--version']).done;assert.equal(nativeRun.code,0);assert.match(nativeRun.stdout,/^v\d+/)
 const second=resolveCliInvocation('claude','claude',argv,{Path:f.root+';'+native,Pathext:'.EXE;.CMD'},runner)
 assert.deepEqual(JSON.parse((await run(second.command,second.args).done).stdout),argv)
})
test('canonical probe PATH wins over an inherited Windows Path',()=>{
 const seen=[]
 assert.throws(()=>resolveCapabilityCli('claude',{Path:'C:\\stale',PATH:'C:\\chosen',PATHEXT:'.CMD'},'win32',p=>{seen.push(p);return p}),/Unsupported/)
 assert.deepEqual(seen,['C:\\chosen\\claude.CMD'])
})
test('legacy Codex JS dispatcher cannot launch without a contained native vendor executable',t=>{
 const f=fixture(t,'codex','bin/codex.js')
 assert.throws(()=>resolveNpmEntry('codex',f.shim),/Unsupported/)
 const triple=process.arch==='arm64'?'aarch64':'x86_64',bin=path.join(f.pkg,'vendor',triple+'-pc-windows-msvc','codex','codex.exe')
 fs.mkdirSync(path.dirname(bin),{recursive:true});fs.writeFileSync(bin,peFixture())
 const result=resolveNpmEntry('codex',f.shim)
 assert.equal(result.command,fs.realpathSync(bin));assert.equal(result.script,undefined)
 assert.equal(result.env.CODEX_MANAGED_PACKAGE_ROOT,fs.realpathSync(f.pkg))
 assert.deepEqual(result.unsetEnv,['CODEX_MANAGED_BY_NPM','CODEX_MANAGED_BY_BUN','CODEX_MANAGED_BY_PNPM','CODEX_MANAGED_BY_VITE_PLUS','CODEX_MANAGED_PACKAGE_ROOT'])
})

test('npm native environment replaces stale root and mutually exclusive package-manager markers',()=>{
 const inherited={KeepSecret:'preserved',CODEX_MANAGED_BY_NPM:'0',CODEX_MANAGED_BY_BUN:'1',codex_managed_by_pnpm:'1',CODEX_MANAGED_BY_VITE_PLUS:'1',CODEX_MANAGED_PACKAGE_ROOT:'other-package'}
 const invocation={env:{CODEX_MANAGED_BY_NPM:'1',CODEX_MANAGED_PACKAGE_ROOT:'validated-root'},unsetEnv:['CODEX_MANAGED_BY_NPM','CODEX_MANAGED_BY_BUN','CODEX_MANAGED_BY_PNPM','CODEX_MANAGED_BY_VITE_PLUS','CODEX_MANAGED_PACKAGE_ROOT']}
 assert.deepEqual(cliInvocationEnv(inherited,invocation),{KeepSecret:'preserved',CODEX_MANAGED_BY_NPM:'1',CODEX_MANAGED_PACKAGE_ROOT:'validated-root'})
 assert.equal(inherited.CODEX_MANAGED_PACKAGE_ROOT,'other-package')
})

test('legacy vendor path helper directory is validated and prepended before inherited Windows PATH',t=>{
 const f=fixture(t,'codex','bin/codex.js'),triple=process.arch==='arm64'?'aarch64':'x86_64',vendor=path.join(f.pkg,'vendor',triple+'-pc-windows-msvc')
 fs.mkdirSync(path.join(vendor,'codex'),{recursive:true});fs.writeFileSync(path.join(vendor,'codex','codex.exe'),peFixture())
 const helper=path.join(vendor,'path');fs.mkdirSync(helper)
 const launch=resolveNpmEntry('codex',f.shim)
 assert.deepEqual(launch.pathPrepend,[fs.realpathSync(helper)])
 assert.equal(cliInvocationEnv({Path:'C:\\user;C:\\system'},launch).PATH,fs.realpathSync(helper)+';C:\\user;C:\\system')
 fs.rmdirSync(helper);const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,helper,'junction')
 assert.throws(()=>resolveNpmEntry('codex',f.shim),/Unsupported/)
})
