import {setApplicationHome} from './appHome.ts'
// Must run before modules compute profile/home paths. Lab never migrates real credentials/hooks.
import {app} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {isIslandLab,islandLabProfile,labEnvironment,initializeLabHome} from './islandLabPolicy.ts'
if(isIslandLab(app.getName())){
 const verifyRoot=process.env.EAS_VERIFY==='1' ? process.env.EAS_ISLAND_LAB_VERIFY_ROOT : undefined
 const profile=verifyRoot && path.isAbsolute(verifyRoot) ? path.join(verifyRoot,'Eas-Term Island Lab') : islandLabProfile(app.getPath('appData'))
 const home=path.join(profile,'isolated-home')
 initializeLabHome(home)
 fs.mkdirSync(path.join(profile,'sessions'),{recursive:true})
 app.setPath('userData',profile)
 app.setPath('sessionData',path.join(profile,'sessions'))
 app.setPath('home',home)
 setApplicationHome(home)
 const isolated=labEnvironment(process.env,home)
 for(const key of Object.keys(process.env))if(!(key in isolated))delete process.env[key]
 Object.assign(process.env,isolated)
 process.env.EAS_ISLAND_NATIVE='1'
}
