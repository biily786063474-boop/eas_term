/** Percent is presentation-only; the transport receives a real catalog id. */
export function effortIndex(percent:number,count:number):number {
 return Number.isFinite(percent) ? Math.round(Math.max(0,Math.min(100,percent))*Math.max(0,count)/100) : 0
}
