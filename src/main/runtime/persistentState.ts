import {guardRuntimeStateFile} from '../fsGuard'
import {createRuntimeStateStore} from './stateStore.ts'
export const runtimeStateStore=createRuntimeStateStore(()=>{
 const result=guardRuntimeStateFile();if(!result.ok)throw Error(result.error);return result.path
})
