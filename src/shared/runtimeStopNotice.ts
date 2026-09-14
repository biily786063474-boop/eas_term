export interface RuntimeStopNotice {id:string|null;message:string}
/** Service IDs include host generation; a replacement is not the stopped instance. */
export function resolveStopNotice(notice:RuntimeStopNotice,services:readonly {id:string}[]|undefined):RuntimeStopNotice{
 return notice.id&&services&&!services.some(service=>service.id===notice.id)?{id:null,message:'服务已关闭'}:notice
}
