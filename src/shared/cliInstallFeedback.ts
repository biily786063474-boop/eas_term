/** Pure, conservative diagnosis. Hints are not a promise that retry will succeed. */
export function installFeedback(error: string, output: string[]): {kind:string;title:string;advice:string} {
 const text=[error,...output].join('\n')
 if (/ENOSPC|no space left|磁盘空间/i.test(text)) return {kind:'disk',title:'磁盘空间不足',advice:'请先清理安装盘的可用空间，再重试。不会自动删除你的文件。'}
 if (/EACCES|EPERM|permission denied|权限不足/i.test(text)) return {kind:'permission',title:'安装目录没有写入权限',advice:'检查目录权限，或更换已提供的安装方式；不要反复重试或直接授予全盘权限。'}
 if (/无法验证程序启动|安装验证异常|查状态超时/i.test(text)) return {kind:'verify',title:'安装结果未能验证',advice:'先重新检测助手状态；若仍找不到程序，请检查安装路径或在终端运行同一命令。不要仅凭安装器退出码判断已可用。'}
 if (/spawn .*ENOENT|(?:\/bin\/bash|powershell\.exe).*not found/i.test(text)) return {kind:'runtime',title:'无法启动安装环境',advice:'安装命令尚未运行。检查系统 shell 是否可用，或复制安装命令在终端执行；不要直接反复重试。'}
 if (/curl:\s*\(60\)|SSL certificate problem|CERT_HAS_EXPIRED|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(text)) return {kind:'certificate',title:'安装连接的证书校验失败',advice:'检查系统时间、代理和公司网络证书；不要关闭 TLS 证书验证。也可尝试软件提供的其他安装方式。'}
 if (/curl:\s*\(22\)|(?:HTTP|returned error:)\s*(?:401|403|404|429|5\d\d)\b/i.test(text)) return {kind:'http',title:'安装服务拒绝或暂时不可用',advice:'查看详情中的 HTTP 状态，检查网络限制或稍后重试；不要反复执行同一条失败命令。'}
 if (/超过.*分钟|timed?\s*out|ETIMEDOUT|超时/i.test(text)) return {kind:'timeout',title:'安装等待超时',advice:'查看最后输出并检查网络或代理。确认旧任务停止后再重试；安静等待本身不代表网络故障。'}
 if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|curl:\s*\((?:5|6|7|28|35)\)|could not resolve|failed to connect|network.*(error|unreachable)/i.test(text)) return {kind:'network',title:'无法连接安装服务',advice:'检查网络、代理或公司网络限制后重试；也可以更换已提供的安装方式。'}
 if (/找不到.*命令|not found|ENOENT/i.test(text)) return {kind:'missing',title:'未检测到可用程序',advice:'安装器退出不等于程序可用。请检查安装位置，修复安装或更换方式后重新验证。'}
 return {kind:'unknown',title:'安装未完成',advice:'目前无法确定原因。展开诊断详情，按实际错误处理后重试；已有版本与配置不会被自动清除。'}
}
