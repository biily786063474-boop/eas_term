import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import os from 'node:os'
import type {IslandState} from '../shared/types.ts'
import {decodeHostEvent, hostPresentation, HostLineDecoder, HOST_FRAME_LIMIT, type HostEvent} from './islandHostProtocol.ts'
export interface IslandWindowHandle {
 isDestroyed():boolean
 destroy():void
 setBounds(bounds:{x:number;y:number;width:number;height:number},animate?:boolean):void
 setIgnoreMouseEvents(ignore:boolean):void
 showInactive():void
 webContents:{send(channel:string,value?:unknown):void}
}
type Options={binary:string;assets:string;generation?:string;onEvent:(e:HostEvent)=>void;onClose:()=>void;onError:(error:string)=>void;launch?:()=>ChildProcessWithoutNullStreams}
/** Only this owned child receives state. Never exposes Electron's general IPC surface. */
export class NativeIslandHost implements IslandWindowHandle {
 readonly completed:Promise<void>
 private child:ChildProcessWithoutNullStreams
 private closed=false
 private exited=false
 private generation:string
 private readyTimer:ReturnType<typeof setTimeout>
 private killTimer:ReturnType<typeof setTimeout>|undefined
 private options:Options
 readonly webContents:{send:(channel:string,value?:unknown)=>void}
 constructor(options:Options){
  this.options=options;this.generation=options.generation??randomUUID()
  this.child=options.launch?.()??spawn(options.binary,[String(process.pid),options.assets,this.generation],{stdio:'pipe',env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:os.homedir(),TMPDIR:os.tmpdir()}})
  this.completed=new Promise(resolve=>this.child.once('close',()=>resolve()))
  this.webContents={send:(channel,value)=>{
   const type=channel.replace(/^island:/,'')
   if(!['state','enter','leave','collapse'].includes(type))return
   this.write({type,value:type==='state'?hostPresentation(value as IslandState):value})
  }}
  this.readyTimer=setTimeout(()=>this.fail('native island ready timeout'),8000);this.readyTimer.unref()
  const decoder=new HostLineDecoder(line=>{
   if(this.closed)return
   const event=decodeHostEvent(line,this.generation)
   if(!event){this.fail('native island invalid frame');return}
   if(event.type==='ready')clearTimeout(this.readyTimer)
   options.onEvent(event)
  })
  this.child.stdout.on('data',(data:Buffer)=>{try{decoder.push(data)}catch{this.fail('native island frame limit')}})
  this.child.stdin.on('error',()=>this.fail('native island input closed'))
  this.child.stdout.on('error',()=>this.fail('native island output closed'))
  // Do not echo native/WebKit diagnostics: they may contain notice text.
  this.child.stderr.on('data',()=>{})
  this.child.on('error',()=>this.fail('native island launch failed'))
  this.child.on('exit',()=>{
   this.exited=true;clearTimeout(this.killTimer);clearTimeout(this.readyTimer)
   if(!this.closed){this.closed=true;options.onError('native island exited unexpectedly');options.onClose()}
  })
 }
 private fail(message:string):void {if(this.closed)return;this.options.onError(message);this.destroy()}
 private write(message:Record<string,unknown>):void {
  if(this.closed)return
  const line=JSON.stringify({v:1,generation:this.generation,...message})+'\n'
  if(Buffer.byteLength(line)>HOST_FRAME_LIMIT||this.child.stdin.writableLength>HOST_FRAME_LIMIT){this.fail('native island outgoing frame limit');return}
  this.child.stdin.write(line)
 }
 isDestroyed():boolean{return this.closed}
 setBounds(b:{x:number;y:number;width:number;height:number}):void{this.write({type:'bounds',...b})}
 setIgnoreMouseEvents(value:boolean):void{this.write({type:'ignoreMouse',value})}
 showInactive():void{this.write({type:'show'})}
 destroy():void {
  if(this.closed)return
  this.closed=true;clearTimeout(this.readyTimer)
  if(!this.child.stdin.destroyed && this.child.stdin.writableLength<=HOST_FRAME_LIMIT)this.child.stdin.write(JSON.stringify({v:1,generation:this.generation,type:'close'})+'\n')
  this.child.stdin.end();this.options.onClose()
  if(!this.exited){this.killTimer=setTimeout(()=>{if(!this.exited)this.child.kill('SIGKILL')},1000);this.killTimer.unref()}
 }
}
