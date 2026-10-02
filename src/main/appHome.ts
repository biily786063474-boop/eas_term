import os from 'node:os'
// Application-owned configuration root, distinct from the OS keychain HOME.
// Set only by trusted Lab bootstrap, before configuration modules load.
let isolatedHome:string|undefined
export function setApplicationHome(home:string):void {isolatedHome=home}
export function applicationHome():string{return isolatedHome??os.homedir()}
/** 子进程 env 只在 Lab 隔离时改写 HOME；正式版保持原样（Windows 上 HOME 原本可能不存在，别悄悄注入） */
export function isolatedApplicationHome():string|undefined{return isolatedHome}
