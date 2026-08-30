// 日志脱敏。**单独成文件是因为它要能被 node --test 直接跑** ——
// log.ts 引了 electron，测试里 import 不进来。
//
// 这一层的职责只有一条：**一次性凭证绝不落盘**。
// 登录流程的输出里带着 OAuth 的 code/state 和设备码，原样写进日志
// 等于把它们留在了一个谁都能读的文件里。**在写之前抹，不是在读的时候** —— 落了盘就晚了。

/** 抹掉一次性凭证。三类：
 *  · URL 查询串里的 code / state / code_challenge（OAuth 那套）
 *  · 形如 `KC89-BN60L` 的设备码
 *  · token / key / secret 字样后面跟的一长串
 *
 *  **抹得不能太狠**：域名、client_id、命令行本身都要留下 ——
 *  那些正是排障时唯一能看的东西。 */
export function redact(s: string): string {
  return s
    .replace(/([?&](?:code|state|code_challenge|access_token|id_token)=)[^&\s]+/gi, '$1<抹去>')
    .replace(/\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b/g, '<设备码>')
    .replace(/((?:token|key|secret)["'\s:=]+)[A-Za-z0-9._-]{12,}/gi, '$1<抹去>')
}
