import type { SecretsStatus } from '../../../../shared/types'

/**
 * 「马上要真用密钥」时决定要不要先弹解锁（secret_check、JEV 验证连接）。
 *
 * 不能拿 secrets.status() 判断：那是**展示态**，信任设备在首用验证之前按「已解锁」呈现
 * （不碰钥匙串）。照它放行，首用验证失败时会白跑一次、拿到一次性的解不开 / 加密不可用错误，
 * 再试才走解锁（2026-09-30 评审遗留 ②）。所以这里走 checkStatus：主进程先跑真门禁再回状态。
 * 这只影响「弹不弹解锁框」，放出什么仍由主进程各自的门禁决定。
 */
export async function vaultStateForUse(api: { checkStatus(): Promise<SecretsStatus> }): Promise<{
  status: SecretsStatus
  needsUnlock: boolean
}> {
  const status = await api.checkStatus()
  return { status, needsUnlock: !status.configured || status.locked }
}
