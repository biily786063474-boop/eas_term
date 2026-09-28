/** Local personal statistics only; never sent to anonymous telemetry. */
export const ACTIVITY_KEYS = ['term','canvas','voice','image','island','approve','view','agent','chat'] as const
export type ActivityKey = typeof ACTIVITY_KEYS[number]
export interface PluginActivity {id:string;opens:number;calls:number}
export interface ActivityDay {date:string;counts:Partial<Record<ActivityKey,number>>;plugins:PluginActivity[]}
export interface ActivityLedger {version:1;since:number;days:ActivityDay[]}
export interface UsageActivitySnapshot {
 days:{date:string;tokens:number|null;rounds:number|null;tokenPartial:boolean;actions:number|null;activityPartial:boolean}[]
 activeDays:number;currentStreak:number;longestStreak:number;sessions:number|null;projects:number|null
 activityAvailable:boolean;tokenAvailable:boolean
 features:{key:ActivityKey;count:number}[];plugins:PluginActivity[]
 since:number;tokenSince:number;error?:string
}
