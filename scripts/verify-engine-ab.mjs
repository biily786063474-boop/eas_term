#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
const candidateIndex=process.argv.indexOf('--candidate');if(candidateIndex<0||!process.argv[candidateIndex+1])throw Error('explicit --candidate Electron executable required')
const candidate=path.resolve(process.argv[candidateIndex+1]);if(!fs.existsSync(candidate))throw Error('candidate executable missing')
const oi=process.argv.indexOf('--out'),out=oi<0?'docs/verification/native-engine':process.argv[oi+1];fs.mkdirSync(out,{recursive:true});const progress=phase=>{fs.writeFileSync(out+'/ab-progress.json',JSON.stringify({phase,at:new Date().toISOString()},null,2));console.log(phase)}
const abort=new AbortController(),sleep=ms=>delay(ms,undefined,{signal:abort.signal});let child,log
const interrupt=()=>{abort.abort();if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM')}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
try{
 for(let i=0;fs.existsSync('docs/verification/memory-attribution/RUNNING.local');i++){if(i>=30)throw Error('native diagnosis still active after 5m');progress('等待原生采样退出，避免互相影响内存读数');await sleep(10000)}
 for(const [group,n] of [['a',1],['b',1],['b',2],['a',2],['a',3],['b',3]]){
  abort.signal.throwIfAborted();const tag='ab-'+group+'-'+n;progress(tag+' / 40轮进行中')
  const args=['scripts/verify-widget-lifecycle.mjs','--out',out,'--tag',tag,...(group==='b'?['--engine',candidate]:[])]
  log=fs.createWriteStream(out+'/'+tag+'.runner.local.log');child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});log.end();log=null
  abort.signal.throwIfAborted();if(code!==0)throw Error(tag+' / FAILED (see result)');child=null;progress(tag+' / 完成');await sleep(2000)
 }
 progress('finished')
}catch(e){process.exitCode=1;progress('FAILED: '+String(e))}finally{
 if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([ended,delay(15000)])}
 log?.end();process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
}
