import os from 'node:os'
// Application-owned configuration root, distinct from the OS keychain HOME.
// Set only by trusted Lab bootstrap, before configuration modules load.
let isolatedHome:string|undefined
export function setApplicationHome(home:string):void {isolatedHome=home}
export function applicationHome():string{return isolatedHome??os.homedir()}
