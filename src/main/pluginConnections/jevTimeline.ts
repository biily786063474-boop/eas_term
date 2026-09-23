/** Installed metadata is a UI prerequisite, never permission to execute. */
export function jevTimelineReady(version?:string):boolean{
 const m=version?.match(/^(\d+)\.(\d+)\.(\d+)$/)
 return !!m&&(Number(m[1])>1||(Number(m[1])===1&&(Number(m[2])>0||Number(m[3])>=1)))
}
