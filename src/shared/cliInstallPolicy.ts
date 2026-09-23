/** The read-only snapshot is shareable; cancellation is not. */
export function canCancelTask(task:{cli:string;taskId?:number;windowId?:number},cli:unknown,taskId:unknown,windowId:number):boolean {
 return task.cli===cli&&typeof taskId==='number'&&task.taskId===taskId&&task.windowId===windowId
}
export function restoreInstallSnapshot(phase:string,from:'install'|'login',installed:boolean):boolean {
 return !(phase==='done'&&from==='install'&&!installed)
}
