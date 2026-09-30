import { tm } from './i18n/current.ts'
/** Pure, conservative diagnosis. Hints are not a promise that retry will succeed. */
export function installFeedback(error: string, output: string[]): {kind:string;title:string;advice:string} {
 const text=[error,...output].join('\n')
 if (/ENOSPC|no space left|磁盘空间/i.test(text)) return {kind:'disk',title:tm('errCore.installFb.diskTitle'),advice:tm('errCore.installFb.diskAdvice')}
 if (/EACCES|EPERM|permission denied|权限不足/i.test(text)) return {kind:'permission',title:tm('errCore.installFb.permTitle'),advice:tm('errCore.installFb.permAdvice')}
 if (/无法验证程序启动|安装验证异常|查状态超时|Could not verify the program starts|Install verification failed|Status check timed out/i.test(text)) return {kind:'verify',title:tm('errCore.installFb.verifyTitle'),advice:tm('errCore.installFb.verifyAdvice')}
 if (/spawn .*ENOENT|(?:\/bin\/bash|powershell\.exe).*not found/i.test(text)) return {kind:'runtime',title:tm('errCore.installFb.runtimeTitle'),advice:tm('errCore.installFb.runtimeAdvice')}
 if (/curl:\s*\(60\)|SSL certificate problem|CERT_HAS_EXPIRED|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(text)) return {kind:'certificate',title:tm('errCore.installFb.certTitle'),advice:tm('errCore.installFb.certAdvice')}
 if (/curl:\s*\(22\)|(?:HTTP|returned error:)\s*(?:401|403|404|429|5\d\d)\b/i.test(text)) return {kind:'http',title:tm('errCore.installFb.httpTitle'),advice:tm('errCore.installFb.httpAdvice')}
 if (/超过.*分钟|did not finish within|timed?\s*out|ETIMEDOUT|超时/i.test(text)) return {kind:'timeout',title:tm('errCore.installFb.timeoutTitle'),advice:tm('errCore.installFb.timeoutAdvice')}
 if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|curl:\s*\((?:5|6|7|28|35)\)|could not resolve|failed to connect|network.*(error|unreachable)/i.test(text)) return {kind:'network',title:tm('errCore.installFb.networkTitle'),advice:tm('errCore.installFb.networkAdvice')}
 if (/找不到.*命令|can't find the command|not found|ENOENT/i.test(text)) return {kind:'missing',title:tm('errCore.installFb.missingTitle'),advice:tm('errCore.installFb.missingAdvice')}
 return {kind:'unknown',title:tm('errCore.installFb.unknownTitle'),advice:tm('errCore.installFb.unknownAdvice')}
}
