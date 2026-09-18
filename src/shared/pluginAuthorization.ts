/** Credential-free UI contract. Authorized means local token exists, not service availability. */
export type PluginAuthorizationStatus='disconnected'|'authorized'|'expired'|'locked-or-unavailable'
export type PluginAuthorizationAction='status'|'login'|'disconnect'
export type PluginAuthorizationResult={ok:true;status:PluginAuthorizationStatus}|{ok:false;error:string}
export function pluginAuthorizationLabel(status:PluginAuthorizationStatus):string {
 return {disconnected:'账号未连接',authorized:'凭证已保存 · 尚未测试连接',expired:'凭证已过期 · 调用前尝试刷新','locked-or-unavailable':'请先解锁密钥柜；或检查系统加密是否可用'}[status]
}
