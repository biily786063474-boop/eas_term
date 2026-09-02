// omp 引导链路的主进程侧：查状态、存服务商与 key、列模型、冒烟。
//
// **这是 `omp/` 底下唯一另一个允许 import electron 的文件**（另一个是 `launch.ts`）。
// 判据全在 `setupModel.ts`（纯函数、有单测），这一层只做 IO 与 IPC。
//
// ── 它是第三条不走 fsGuard 的写通道 ──────────────────────────────────────────
// 13-所有权矩阵那张表原话是「就这两条，多出第三条即红旗」—— 这就是第三条，
// 已登记。它的守卫**比 fsGuard 更窄**：落点只能在 `<userData>/omp/agent` 之内，
// 而且服务商 id 只允许 `[a-z0-9-]+`（它会被拼进环境变量名与文件路径）。
// 不套 fsGuard 的理由与另外两条相同：那份白名单是「项目根 ＋ 知识库根」，
// 这个目录整个在它之外，放宽 fsGuard 会把**所有**写通道的边界一起放宽。
import { execFile } from 'node:child_process'
import { ipcMain } from 'electron'

import { hostPaths, readOmpUsage, writeManagedConfig, ompBaseEnv } from './launch.ts'
import { ompBinPathOrNull } from './paths.ts'
import { mergeProviderChoice, readOmpSetup, writeOmpSetup, type OmpSetup } from './store.ts'
import {
  keyVarOf,
  nextStepOf,
  ompStateFrom,
  OMP_PROVIDERS,
  providerById,
  type OmpStatus,
  type OmpStep
} from './setupModel.ts'
import { ompAdapter } from '../adapters/omp.ts'
import { refreshCliCache } from '../session.ts'
import { cancelOmpLogin, ompLoginInFlight, startOmpLogin, submitOmpLogin, type OmpLoginState } from './login.ts'

/** 渲染层要的那份状态。**形状照 `CliAuthState` 的前两个字段**（installed / status），
 *  好让 `blockedByAuth`、`.ac-authgate`、`CliStateLabel` 三处不改就能复用；
 *  但**不带 `cli` 字段** —— `CliAuthState['cli']` 是 `'claude' | 'codex'` 的字面联合，
 *  放宽它会把 `cliAuth/*`（承诺零改动的那批）一起拖下水。 */
type Res = { ok: true } | { ok: false; error: string }

/** 服务商 id 的守卫。**它会被拼进环境变量名与文件路径**，
 *  一个 `../` 就能写到 `<userData>/omp` 之外。
 *
 *  **不再要求在我们那份清单里**：omp 认识 70 家，订阅登录那条路要能选到它们全部
 *  （我们那份四家的清单只是「带取 key 链接的推荐位」）。所以判据从「在白名单里」
 *  放宽成「形状安全」—— 真不认识的 id，omp 自己会拒，那句话比我们编的准。 */
function safeProvider(id: unknown): string | null {
  return typeof id === 'string' && /^[a-z0-9.-]+$/.test(id) && id.length <= 64 ? id : null
}

function statusOf(): OmpStatus {
  const host = hostPaths()
  const setup = readOmpSetup(host.userData)
  const bin = ompBinPathOrNull(host)
  const p = providerById(setup.provider?.id)
  // 密钥柜与 key 的实际状态由渲染层自己查（它本来就要 `secrets.status()` 来渲染解锁入口），
  // 这一层只回答「配置里记了什么」——两边的判据合起来才是 nextStepOf 的输入。
  // 这么分是为了不让主进程去猜渲染层此刻看到的柜子状态：柜子会 15 分钟自动上锁，
  // 隔一次 IPC 往返就可能变。
  const loggedIn = !!setup.provider?.loggedInAt
  // **入参也只在一处拼**（`ompStateFrom`）。两侧各拼各的时，渲染层那份漏过
  // authMode 与 loggedIn —— 判据一致、入参分叉，单测全绿而真机全错。
  const step = nextStepOf(
    ompStateFrom({
      installed: !!bin,
      // 柜子那三项在这里一律填「好的」—— 真正的判定在渲染层用 `secrets.status()` 补齐后重算。
      vault: { available: true, configured: true, locked: false, foreign: false },
      provider: setup.provider?.id,
      authMode: setup.provider?.authMode,
      keyInVault: !!p, // 同上，渲染层用 secretsHas 的结果覆盖
      // **判据是「登录那一步真的成功过」，不是「冒烟跑通过」。**
      // 拿冒烟顶替的后果：登录刚完成时冒烟还没跑，于是状态机说「还要去登录」——
      // 用户刚登完就被弹回登录页，再登一次还是弹回来（2026-09-02 真机撞到）。
      loggedIn,
      model: setup.provider?.model
    })
  )
  return {
    installed: !!bin,
    status: { loggedIn: !!setup.provider?.model && !!setup.lastSmoke?.ok, account: p?.label },
    step,
    providers: OMP_PROVIDERS.map((x) => ({ id: x.id, label: x.label, keyUrl: x.keyUrl })),
    provider: setup.provider?.id,
    authMode: setup.provider?.authMode,
    loggedIn,
    model: setup.provider?.model,
    lastSmoke: setup.lastSmoke
  }
}

/** 列这家服务商下能选哪些模型。
 *
 *  走 `omp models ls --json`（上游 `cli-commands.ts:135-139` 注册的子命令，
 *  `models-cli.ts:199-206` 在 json 模式直接吐 `{models:[…]}`）——
 *  **不为了列个模型去起一次真会话**：那要走完 initialize + session/new + close，
 *  而在「还没配好」的机器上这一步本来就最容易失败，失败信息还得从 JSON-RPC error 里挖。 */
function listModels(timeoutMs = 12_000): Promise<{ id: string; label: string }[]> {
  const host = hostPaths()
  const bin = ompBinPathOrNull(host)
  if (!bin) return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(bin, ['models', 'ls', '--json'], { env: ompBaseEnv(host), timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([])
      try {
        const j = JSON.parse(stdout) as { models?: { id?: unknown; name?: unknown }[] }
        const out = (j.models ?? [])
          .map((m) => ({ id: String(m?.id ?? ''), label: String(m?.name ?? m?.id ?? '') }))
          .filter((m) => m.id)
        resolve(out)
      } catch {
        resolve([])
      }
    })
  })
}

export function registerOmpSetupHandlers(): void {
  ipcMain.handle('omp:status', (): OmpStatus => statusOf())

  ipcMain.handle('omp:listModels', (): Promise<{ id: string; label: string }[]> => listModels())

  /** 选定服务商与模型。**key 本身不经这里** —— 它由渲染层直接走
   *  `secrets:save` 存进密钥柜（与用户手填密钥同一条路），这一层只记「选了谁」。
   *  这么分是有意的：密钥的明文一次都不该多经过一个 IPC 通道。 */
  ipcMain.handle('omp:saveProvider', (_e, raw: unknown): Res => {
    const inp = (raw ?? {}) as { provider?: unknown; model?: unknown; thinking?: unknown; authMode?: unknown }
    const id = safeProvider(inp.provider)
    if (!id) return { ok: false, error: '不认识这个模型服务商' }
    // 只认这两个字面量；给不出就按 'apikey'（这个字段是后加的，老配置里没有，
    // 而在它存在之前只有填 key 那一条路）
    const authMode: 'subscription' | 'apikey' = inp.authMode === 'subscription' ? 'subscription' : 'apikey'
    const host = hostPaths()
    const prev = readOmpSetup(host.userData)
    const next: OmpSetup = {
      ...prev,
      // **别在这里手拼这个对象。** 原来就是手拼的，`loggedInAt` 被静默丢掉 ——
      // 于是「登录成功 → 重选一次同一家 → 登录记录没了 → 再登」形成闭环。
      // 合并规则（同家同路留着、换家换路清掉）连同 7 条单测在 `store.ts`。
      provider: mergeProviderChoice(prev.provider, {
        id,
        authMode,
        model: typeof inp.model === 'string' ? inp.model : undefined,
        thinking: typeof inp.thinking === 'string' ? inp.thinking : undefined
      }),
      // 换了服务商 / 换了模型，上一次冒烟的结果就不再代表任何东西
      lastSmoke: undefined
    }
    try {
      writeOmpSetup(host.userData, next)
      // 受管配置跟着重写一遍：不写的话 models.yml 里还是上一家的 apiKey 变量名，
      // 下次起会话会去柜里取一把不存在的 key，症状是 401。
      // **订阅那条路一条都不写** —— 上游明写 `apiKey` 会压过 broker 的 OAuth 令牌，
      // 写下去等于用一个不存在的环境变量顶掉刚登好的订阅。
      writeManagedConfig(host, authMode === 'subscription' ? [] : [{ id }])
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    // 清 CLI 探测缓存：omp 的 available 不随这次变化，但 UI 那侧会重新拉一次状态，
    // 让「已配置」的标签立刻更新而不是等 60 秒 TTL。
    refreshCliCache()
    return { ok: true }
  })

  /** 记一次冒烟结果。**真正的冒烟由渲染层驱动**（它已经有起会话、收事件那套），
   *  这里只负责把结论落盘 —— 免得同一件事有两套起进程的代码。 */
  ipcMain.handle('omp:noteSmoke', (_e, raw: unknown): Res => {
    const inp = (raw ?? {}) as { ok?: unknown; message?: unknown }
    const host = hostPaths()
    const prev = readOmpSetup(host.userData)
    try {
      writeOmpSetup(host.userData, {
        ...prev,
        lastSmoke: {
          ok: inp.ok === true,
          at: Date.now(),
          ...(typeof inp.message === 'string' ? { message: inp.message.slice(0, 500) } : {})
        }
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return { ok: true }
  })

  /** 这家服务商的 key 该存在哪个变量名下。渲染层拿它去调 `secrets:save`。 */
  ipcMain.handle('omp:keyVar', (_e, raw: unknown): { varName: string } | null => {
    const id = safeProvider(raw)
    const p = providerById(id ?? '')
    return p ? { varName: keyVarOf(p) } : null
  })

  // ── 订阅登录 ────────────────────────────────────────────────────────────
  //
  // **和「填 API key」是并列的两种选择。** omp 认识 70 家，头几个正是最要紧的订阅
  // （Claude Pro/Max、ChatGPT Plus/Pro、智谱 GLM Coding Plan、Kimi、Copilot…）——
  // 订阅用户没有 API key，也不该被逼着去申请一把。

  /** omp 支持登录的服务商全名单（`auth-broker list --json`）。
   *  **从它那儿取而不是我们写死** —— 写死的清单会随上游更新而过期，
   *  而且「哪家能订阅登录」本来就该由 omp 说了算。 */
  ipcMain.handle('omp:listAuthProviders', (): Promise<{ id: string; name: string }[]> => {
    const host = hostPaths()
    const bin = ompBinPathOrNull(host)
    if (!bin) return Promise.resolve([])
    return new Promise((resolve) => {
      execFile(bin, ['auth-broker', 'list', '--json'], { env: ompBaseEnv(host), timeout: 12_000 }, (err, stdout) => {
        if (err) return resolve([])
        try {
          const j = JSON.parse(stdout) as { id?: unknown; name?: unknown }[]
          resolve(
            (Array.isArray(j) ? j : [])
              .map((x) => ({ id: String(x?.id ?? ''), name: String(x?.name ?? x?.id ?? '') }))
              .filter((x) => /^[a-z0-9.-]+$/.test(x.id))
          )
        } catch {
          resolve([])
        }
      })
    })
  })

  ipcMain.handle('omp:startLogin', (e, raw: unknown): { ok: boolean; error?: string } => {
    const provider = typeof raw === 'string' && /^[a-z0-9.-]+$/.test(raw) ? raw : null
    if (!provider) return { ok: false, error: '不认识这个服务商' }
    const wc = e.sender
    return startOmpLogin(hostPaths(), provider, (st: OmpLoginState) => {
      // **成功的那一刻就落盘。** 由这边记而不是让渲染层回头调一次 IPC：
      // 观察到这件事的是主进程，让它自己记，中间少一个可能丢的往返。
      if (st.phase === 'done') {
        const host = hostPaths()
        const prev = readOmpSetup(host.userData)
        if (prev.provider?.id === provider) {
          writeOmpSetup(host.userData, {
            ...prev,
            provider: { ...prev.provider, loggedInAt: Date.now() }
          })
        }
      }
      // 只推给发起的那个窗口 —— 与 agentChat 的事件同一条纪律，不全窗口广播
      if (!wc.isDestroyed()) wc.send('omp:login', st)
    })
  })

  ipcMain.handle('omp:submitLogin', (_e, raw: unknown): { ok: boolean; error?: string } =>
    typeof raw === 'string' ? submitOmpLogin(raw) : { ok: false, error: '要提交的内容不能为空' }
  )

  ipcMain.handle('omp:cancelLogin', (): { ok: boolean } => cancelOmpLogin())

  ipcMain.handle('omp:loginInFlight', (): OmpLoginState | null => ompLoginInFlight())

  /** 订阅额度的原始数据（数据层用）。**不做任何裁剪之外的加工** ——
   *  额度条那条路走 `quotaStore`，这里是给「看一眼原始输出」用的。 */
  ipcMain.handle('omp:usage', async (): Promise<unknown> => {
    const ok = await ompAdapter.detect(hostPaths())
    return ok ? readOmpUsage(hostPaths()) : null
  })
}
