import {useCallback,useLayoutEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react'
import {recoveryRegistry,recoveryState,recoveryTransferring} from './rendererRecovery'
/** Keeps transient input in the in-memory checkpoint. No new disk persistence.
 * A queued React update vetoes preparation until its layout effect commits. */
export function useRecoveryState<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
 const [value,setValue]=useState<T>(()=>recoveryState.read<T>(key)??initial)
 const ref=useRef(value),pending=useRef(false),valid=useRef(true),identity=useRef(key)
 useLayoutEffect(()=>{
  if(identity.current!==key){
   identity.current=key
   const next=recoveryState.read<T>(key)??initial
   if(!Object.is(next,value)){pending.current=true;setValue(next);return}
  }
  ref.current=value;pending.current=false
  valid.current=true
  recoveryRegistry.changed()
 },[key,value])
 useLayoutEffect(()=>{const unregister=recoveryRegistry.register('state:'+key,{
  ready:()=>!pending.current&&valid.current,
  flush:async()=>{if(pending.current||!valid.current)return false;try{recoveryState.write(key,ref.current);return true}catch{return false}}
 });return()=>{unregister();if(!recoveryTransferring())recoveryState.remove(key)}},[key])
 const update=useCallback<Dispatch<SetStateAction<T>>>(next=>{
  const resolved=typeof next==='function'?(next as (v:T)=>T)(ref.current):next
  if(Object.is(resolved,ref.current))return
  ref.current=resolved;pending.current=true;recoveryRegistry.changed();setValue(resolved)
 },[])
 return [value,update]
}
