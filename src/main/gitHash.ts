// git 处理器收到的 hash 只能是十六进制提交号：`--output=<路径>` 之类的字符串会被 git 当选项，
// 能把 diff 写到任意文件（2026-09-14 审查）。零 electron。
export const isCommitHash = (hash: unknown): hash is string => typeof hash === 'string' && /^[0-9a-fA-F]{7,40}$/.test(hash)
