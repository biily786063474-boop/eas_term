// Deliberately never interpolate native error text into UI: it may contain a
// prompt, file path, server response, or credential. Keep the categories stable.
export function codexTaskFailureKind(error) {
 const message=String(error?.message??'')
 if(message.startsWith('Codex RPC timeout: thread/goal/get'))return 'goal-read-timeout'
 if(message.startsWith('Codex RPC timeout:'))return 'rpc-timeout'
 if(message.startsWith('Codex requires unsupported interactive request:'))return 'unsupported-request'
 if(message.startsWith('Codex app-server exited')||message.includes('Codex input closed')||message.includes('Codex output closed'))return 'channel-closed'
 if(message.startsWith('Codex task cancelled'))return 'cancelled'
 if(message.startsWith('Codex authentication_error'))return 'authentication'
 if(message.startsWith('Unknown native goal state')||message.includes('Codex RPC failed'))return 'protocol'
 if(message.startsWith('Codex turn '))return 'native-turn'
 return 'unknown'
}
export function codexTaskFailure(error) {
 const message=String(error?.message??'')
 if(message.startsWith('Codex RPC timeout: thread/goal/get'))return 'Codex 任务状态查询超时；未重新提交任务。请检查原任务是否仍在运行。'
 if(message.startsWith('Codex RPC timeout:'))return 'Codex 原生接口响应超时；未重新提交任务。请检查 CLI 进程与原任务状态。'
 if(message.startsWith('Codex requires unsupported interactive request:'))return '当前版本请求了软件尚未支持的交互请求；本轮已停止，未自动重试。'
 if(message.startsWith('Codex app-server exited')||message.includes('Codex input closed')||message.includes('Codex output closed'))return 'Codex 原生进程或通信通道意外关闭；未重新提交任务。请检查原任务结果后再决定是否重试。'
 if(message.startsWith('Codex task cancelled'))return 'Codex 任务已取消。'
 if(message.startsWith('Codex authentication_error'))return 'Codex 登录已失效；请重新登录后再发送新任务，原任务未自动重试。'
 if(message.startsWith('Unknown native goal state')||message.includes('Codex RPC failed'))return 'Codex 原生任务协议不兼容；本轮未自动重试，请检查 CLI 版本。'
 if(message.startsWith('Codex turn '))return 'Codex 原生任务执行失败；请先检查已有结果，避免重复执行。'
 return 'Codex 原生任务未能完成；未自动重试。请检查已有结果和 CLI 诊断日志。'
}
