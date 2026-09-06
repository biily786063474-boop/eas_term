// eas-write-guard.mjs 是给 Claude Code 当外部进程跑的独立脚本（不能 import electron），
// 唯一在 TS 世界里被消费的入口是 `isWriteCommand`——`writeGuard.test.ts` 要 import 它，
// 而这份 .mjs 本身不经 tsc 编译，需要一份手写的类型声明让测试文件过 typecheck。
// **改 .mjs 里 isWriteCommand 的签名，这份声明要跟着改**——两者没有自动同步机制。
export declare function isWriteCommand(cmd: string): boolean
