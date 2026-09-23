/** 空 Frame 入口的用户文案，不改 CLI 的内部身份和其他界面名称。 */
export function startChoicePresentation(
  cli: { id: string; displayName: string }
): { name: string; tip: string } {
  if (cli.id === 'omp') {
    return { name: '原生 Harness', tip: '基于 OMP 二次开发，支持多模型登录' }
  }
  if (cli.id === 'claude' || cli.id === 'codex') {
    return { name: cli.displayName, tip: '官方原生架构；下载安装需留意网络环境' }
  }
  return { name: cli.displayName, tip: `使用 ${cli.displayName} 开始 AI 对话` }
}
