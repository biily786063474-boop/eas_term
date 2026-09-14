// S1（2026-09-14 评审）：安装命令的唯一来源是主进程的 installPlan()。渲染层传来的字符串
// 只能用来"选"方案表里的某一条——逐字命中才算；不在表里的一律拒绝，不给任何命令。
// 之前的形状是「主进程算出命令 → 发给界面 → 界面原样传回 → 主进程直接 sh -c」，
// 绕一圈却在入口处信任了它：界面被注入即等于以用户身份执行任意命令。零 electron。
type PlanEntry = { readonly options?: readonly { readonly cmd: string }[] } | undefined

export function resolveInstallCommand(plan: object, cli: string, requested: string | undefined): { ok: true; cmd: string } | { ok: false; error: string } {
  const options = (plan as Record<string, PlanEntry>)[cli]?.options ?? []
  if (!options.length) return { ok: false, error: `没有 ${cli} 的安装方案` }
  if (requested === undefined) return { ok: true, cmd: options[0].cmd }
  const hit = options.find(o => o.cmd === requested)
  return hit ? { ok: true, cmd: hit.cmd } : { ok: false, error: '安装命令不在软件的方案表里，已拒绝执行' }
}
