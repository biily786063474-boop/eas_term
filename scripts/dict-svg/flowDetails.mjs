// 后端 40 条词条各自的分层流向图。**每张只回答两件事：作用在哪一层、那一层上发生了什么。**
// 复用件见 flow.mjs；底部那行字不是装饰 —— 后端机制光看方块动是猜不出来的。
import { lanes, packet, track, caption, box, outline, rows, text, showAt, anim, C, LANES as L } from './flow.mjs'

const cy = (k) => L[k].y + L[k].h / 2
const rx = (k) => L[k].x + L[k].w
const lx = (k) => L[k].x
/** 服务层内部的可用区域 */
const S = { x: L.service.x + 5, y: L.service.y + 6, w: L.service.w - 10, h: L.service.h - 12 }
/** 客户端 → 服务、服务 → 存储 两条主轨道 */
const rail = track(rx('client'), cy('client'), lx('service'), cy('service'))
  + track(rx('service'), cy('service'), lx('store'), cy('store'))
const req = (t, col) => packet(rx('client'), cy('client'), lx('service'), cy('service'), t, col)
const down = (t, col) => packet(rx('service'), cy('service'), lx('store'), cy('store'), t, col)
const back = (t, col) => packet(lx('service'), cy('service') + 12, rx('client'), cy('client') + 12, t, col)

export const FLOWS = {
  // ── 接口与契约 ──────────────────────────────────────────────────────────
  'idempotency-key': () => lanes('service') + rail
    + req([0.05, 0.17]) + down([0.18, 0.29], C.ok)
    + req([0.42, 0.55])
    + showAt(outline(S.x + 4, S.y + 26, S.w - 8, 13, C.hi, '已处理过'), 0.55, 0.86)
    + back([0.6, 0.74], C.ok)
    + caption('同一个键第二次到达：不再执行，直接返回上次结果'),

  'cursor-pagination-api': () => lanes('store') + rail
    + rows(L.store.x + 6, L.store.y + 6, 34, 8, 4, 1.6, C.block, 0.5)
    + showAt(rows(L.store.x + 6, L.store.y + 6, 34, 3, 4, 1.6, C.hi), 0.1, 0.45)
    + showAt(rows(L.store.x + 6, L.store.y + 23, 34, 3, 4, 1.6, C.hi), 0.5, 0.92)
    + showAt(text(L.store.x + 23, L.store.y + 55, '游标 ↓', C.hi, 5), 0.45, 0.92)
    + req([0.02, 0.1]) + req([0.42, 0.5])
    + caption('拿上一页最后一条的位置往下取，不数 OFFSET'),

  'api-versioning': () => lanes('service') + rail
    + box(S.x, S.y + 4, S.w, 14, 'v1', C.block)
    + box(S.x, S.y + 24, S.w, 14, 'v2', C.block)
    + showAt(outline(S.x, S.y + 4, S.w, 14, C.dim), 0.1, 0.45)
    + showAt(outline(S.x, S.y + 24, S.w, 14, C.hi), 0.5, 0.92)
    + req([0.02, 0.1]) + req([0.42, 0.5])
    + caption('破坏性改动才升版本，两版共存到老客户端退完'),

  'error-code-layers': () => lanes('service') + rail
    + showAt(box(S.x, S.y + 6, S.w, 12, '4xx 你的问题', C.block, C.hi, 5), 0.08, 0.44)
    + showAt(box(S.x, S.y + 26, S.w, 12, '5xx 我的问题', C.block, C.bad, 5), 0.5, 0.9)
    + req([0.02, 0.08]) + back([0.3, 0.42], C.hi)
    + req([0.44, 0.5]) + back([0.72, 0.86], C.bad)
    + caption('状态码分「归谁管」，业务码说「具体哪件事」'),

  'partial-failure': () => lanes('service') + rail
    + req([0.03, 0.12])
    + rows(S.x + 6, S.y + 4, S.w - 12, 5, 5, 2, C.block)
    + showAt(box(S.x + 6, S.y + 18, S.w - 12, 5, '', C.bad), 0.35, 0.92)
    + showAt(text(S.x + S.w / 2, S.y + 46, '3 成 · 1 败', C.dim, 5.5), 0.45, 0.92)
    + back([0.58, 0.72], C.hi)
    + caption('逐条返回结果，客户端才知道该重试哪几条'),

  'async-job-202': () => lanes('service') + rail
    + req([0.03, 0.12]) + back([0.13, 0.22], C.hi)
    + showAt(text(rx('client') + 14, cy('client') - 12, '202', C.hi, 6), 0.2, 0.35)
    + showAt(box(S.x, S.y + 20, S.w, 12, 'running', C.block, C.hi, 5), 0.25, 0.62)
    + showAt(box(S.x, S.y + 20, S.w, 12, 'done', C.block, C.ok, 5), 0.66, 0.95)
    + req([0.38, 0.46]) + req([0.68, 0.76])
    + caption('立刻返回任务号，客户端轮询状态，不占着连接干等'),

  'webhook-retry': () => lanes('service', { store: { label: '接收方' } })
    + track(rx('service'), cy('service'), lx('store'), cy('store'), true)
    + down([0.05, 0.15], C.bad) + down([0.24, 0.34], C.bad) + down([0.5, 0.6], C.bad)
    + down([0.78, 0.9], C.ok)
    + showAt(text(S.x + S.w / 2, S.y + 60, '10s · 1min · 5min', C.hi, 5.5), 0.3, 0.95)
    + caption('投不到就按退避重投，重投耗尽进死信'),

  'rate-limit-headers': () => lanes('service') + rail
    + req([0.02, 0.1]) + req([0.14, 0.22]) + req([0.26, 0.34]) + req([0.4, 0.48])
    + showAt(box(S.x, S.y + 22, S.w, 14, '429', C.block, C.bad, 6), 0.5, 0.92)
    + back([0.54, 0.68], C.bad)
    + showAt(text(rx('client') + 16, cy('client') + 26, 'Retry-After', C.hi, 5), 0.62, 0.92)
    + caption('拒绝时要告诉对方「还剩多少、多久能再来」'),

  'sparse-fieldsets': () => lanes('store') + rail
    + rows(L.store.x + 6, L.store.y + 8, 34, 6, 5, 2, C.block, 0.45)
    + showAt(rows(L.store.x + 6, L.store.y + 8, 12, 6, 5, 2, C.hi), 0.35, 0.92)
    + req([0.05, 0.15]) + down([0.16, 0.28])
    + showAt(text(S.x + S.w / 2, S.y + 58, 'fields=id,name', C.hi, 5), 0.2, 0.92)
    + caption('调用方声明只要哪几列，查询本身也跟着变少'),

  // 层名用 lanes 的 override 改，**别另画一个标签** —— 会和 lanes 画的那个叠在一起
  'contract-test': () => lanes('service', { client: { label: '消费方' } }) + rail
    + showAt(box(L.client.x + 5, L.client.y + 16, 36, 12, '契约', C.block, C.hi, 5), 0.08, 0.95)
    + req([0.2, 0.32])
    + showAt(text(S.x + S.w / 2, S.y + 30, '✓ 兼容', C.ok, 6), 0.36, 0.6)
    + showAt(text(S.x + S.w / 2, S.y + 30, '✗ 改坏了', C.bad, 6), 0.64, 0.94)
    + caption('消费方声明依赖，提供方 CI 里跑，改坏了合并前就红'),

  // ── 存储与查询 ──────────────────────────────────────────────────────────
  'composite-index-order': () => lanes('store', { store: { label: '索引' } })
    + rail + req([0.03, 0.12]) + down([0.13, 0.24])
    + box(L.store.x + 5, L.store.y + 8, 36, 9, 'a = ?', C.block, C.hi, 5)
    + box(L.store.x + 5, L.store.y + 21, 36, 9, 'b > ?', C.block, C.dim, 5)
    + box(L.store.x + 5, L.store.y + 34, 36, 9, 'order c', C.block, C.dim, 5)
    + showAt(outline(L.store.x + 3, L.store.y + 6, 40, 13, C.hi), 0.3, 0.95)
    + caption('等值列在前、范围列在后 —— 跳过一列，后面全废'),

  'soft-delete-cost': () => lanes('store') + rail
    + rows(L.store.x + 6, L.store.y + 8, 34, 6, 5, 2, C.block)
    + showAt(box(L.store.x + 6, L.store.y + 22, 34, 5, '', C.block, C.dim) + text(L.store.x + 23, L.store.y + 26.5, 'deleted', C.bad, 4.5), 0.2, 0.95)
    + req([0.03, 0.12]) + down([0.13, 0.24])
    + showAt(text(S.x + S.w / 2, S.y + 56, '每个查询都要记得过滤', C.hi, 5), 0.4, 0.95)
    + caption('标记删除：漏一个过滤就是数据泄漏，而且不报错'),

  'optimistic-lock': () => lanes('store') + rail
    + box(L.store.x + 6, L.store.y + 22, 34, 12, 'v=7', C.block, C.hi, 5.5)
    + req([0.03, 0.12]) + down([0.13, 0.24], C.ok)
    + showAt(text(L.store.x + 23, L.store.y + 45, 'v=8', C.ok, 5.5), 0.26, 0.95)
    + req([0.34, 0.44]) + down([0.45, 0.56], C.bad)
    + showAt(text(S.x + S.w / 2, S.y + 58, '409 冲突', C.bad, 6), 0.6, 0.95)
    + caption('更新带上读到的版本号，对不上就是别人先改了'),

  'deep-pagination': () => lanes('store') + rail
    + rows(L.store.x + 6, L.store.y + 6, 34, 10, 3.4, 1.4, C.block, 0.4)
    + showAt(rows(L.store.x + 6, L.store.y + 6, 34, 9, 3.4, 1.4, C.bad, 0.5) + text(L.store.x + 23, L.store.y + 68, '扫过并丢弃', C.bad, 4.6), 0.15, 0.5)
    + showAt(rows(L.store.x + 6, L.store.y + 6 + 9 * 4.8, 34, 1, 3.4, 1.4, C.hi) + text(L.store.x + 23, L.store.y + 68, '游标直达', C.ok, 4.6), 0.58, 0.95)
    + req([0.03, 0.12]) + req([0.5, 0.56])
    + caption('OFFSET 越翻越慢；游标翻页与页码无关'),

  'replica-lag': () => lanes('store', { store: { label: '从库' } }) + rail
    + box(L.client.x + 6, L.client.y + 8, 34, 12, '写', C.block, C.hi, 5.5)
    + showAt(text(S.x + S.w / 2, S.y + 12, '主库 v2', C.ok, 5.5), 0.1, 0.95)
    + showAt(text(L.store.x + 23, L.store.y + 30, 'v1', C.bad, 6), 0.25, 0.62)
    + showAt(text(L.store.x + 23, L.store.y + 30, 'v2', C.ok, 6), 0.66, 0.95)
    + req([0.02, 0.1]) + req([0.3, 0.4])
    + caption('刚写完就读从库会看到旧值 —— 这类读要走主库'),

  'transaction-boundary': () => lanes('service') + rail
    + showAt(outline(S.x, S.y + 4, S.w, 18, C.ok, '') + text(S.x + S.w / 2, S.y + 15, '只放写库', C.ok, 5), 0.1, 0.95)
    + showAt(outline(S.x, S.y + 30, S.w, 22, C.bad, '') + text(S.x + S.w / 2, S.y + 38, 'HTTP 调用', C.bad, 5)
      + text(S.x + S.w / 2, S.y + 47, '别放事务里', C.bad, 4.6), 0.42, 0.95)
    + req([0.03, 0.1]) + down([0.11, 0.2], C.ok)
    + caption('事务里只放数据库写；外部调用挪出去'),

  'unique-constraint': () => lanes('store') + rail
    + req([0.03, 0.12]) + req([0.06, 0.15])
    + down([0.18, 0.3], C.ok) + down([0.2, 0.32], C.bad)
    + showAt(outline(L.store.x + 5, L.store.y + 20, 36, 14, C.hi, '唯一索引'), 0.14, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 58, '一个成功 · 一个 409', C.dim, 5), 0.4, 0.95)
    + caption('先查后插挡不住并发 —— 唯一索引才是那道门'),

  'json-column': () => lanes('store') + rail
    + rows(L.store.x + 6, L.store.y + 8, 20, 4, 5, 2, C.block)
    + box(L.store.x + 28, L.store.y + 8, 12, 26, '{ }', C.block2, C.hi, 5.5)
    + showAt(text(L.store.x + 23, L.store.y + 46, '要筛的 → 真列', C.ok, 4.8), 0.2, 0.55)
    + showAt(text(L.store.x + 23, L.store.y + 46, '不筛的 → JSON', C.hi, 4.8), 0.6, 0.95)
    + req([0.03, 0.12]) + down([0.13, 0.24])
    + caption('会被当查询条件的必须是真列，其余才放 JSON'),

  'archive-partition': () => lanes('store') + rail
    + box(L.store.x + 5, L.store.y + 6, 36, 12, '本月', C.block, C.hi, 5)
    + box(L.store.x + 5, L.store.y + 21, 36, 12, '上月', C.block, C.dim, 5)
    + showAt(box(L.store.x + 5, L.store.y + 36, 36, 12, '去年', C.block, C.dim, 5), 0.05, 0.5)
    + showAt(text(L.store.x + 23, L.store.y + 45, 'DROP', C.bad, 5.5), 0.56, 0.95)
    + req([0.03, 0.12]) + down([0.13, 0.24])
    + caption('按时间分区，过期整块 DROP —— 不用 DELETE 几千万行'),

  'slow-query-hunt': () => lanes('store') + rail
    + rows(L.store.x + 6, L.store.y + 8, 10, 5, 5, 2, C.block)
    + showAt(box(L.store.x + 6, L.store.y + 8, 32, 5, '', C.bad), 0.15, 0.5)
    + showAt(text(L.store.x + 23, L.store.y + 48, '最慢 ≠ 最该修', C.dim, 4.8), 0.15, 0.5)
    + showAt(box(L.store.x + 6, L.store.y + 22, 16, 5, '', C.hi) + box(L.store.x + 6, L.store.y + 29, 16, 5, '', C.hi)
      + box(L.store.x + 6, L.store.y + 36, 16, 5, '', C.hi), 0.58, 0.95)
    + showAt(text(L.store.x + 23, L.store.y + 48, '总耗时最高', C.hi, 4.8), 0.58, 0.95)
    + req([0.02, 0.1])
    + caption('按「平均 × 次数」排，不是按单次最慢排'),

  // ── 可靠性与容错 ────────────────────────────────────────────────────────
  'backoff-jitter': () => lanes('service', { store: { label: '下游' } })
    + track(rx('service'), cy('service'), lx('store'), cy('store'), true)
    + down([0.04, 0.12], C.bad) + down([0.2, 0.28], C.bad) + down([0.44, 0.52], C.bad)
    + down([0.76, 0.86], C.ok)
    + showAt(text(S.x + S.w / 2, S.y + 20, '100ms', C.hi, 5), 0.14, 0.3)
    + showAt(text(S.x + S.w / 2, S.y + 20, '200ms ±', C.hi, 5), 0.32, 0.54)
    + showAt(text(S.x + S.w / 2, S.y + 20, '400ms ±', C.hi, 5), 0.56, 0.88)
    + showAt(text(S.x + S.w / 2, S.y + 40, '± 是抖动', C.dim, 4.8), 0.34, 0.95)
    + caption('间隔翻倍并加随机抖动，否则大家同时回来再打一次'),

  'circuit-breaker': () => lanes('service')
    + track(rx('client'), cy('client'), lx('service'), cy('service'))
    + track(rx('service'), cy('service'), lx('store'), cy('store'), true)
    + req([0.02, 0.1]) + down([0.11, 0.2], C.bad)
    + req([0.16, 0.24]) + down([0.25, 0.34], C.bad)
    + showAt(`<path d="M${rx('service') + 9} ${cy('service') - 9} l0 18" stroke="${C.bad}" stroke-width="1.6"/>`, 0.38, 0.78)
    + showAt(text(S.x + S.w / 2, S.y + 16, '开路', C.bad, 6), 0.38, 0.78)
    + req([0.44, 0.52]) + back([0.53, 0.62], C.bad)
    + showAt(text(S.x + S.w / 2, S.y + 16, '半开试探', C.hi, 5.5), 0.82, 0.97)
    + down([0.86, 0.95], C.ok)
    + caption('连续失败就断开，调用立即失败；冷却后放少量试探'),

  'bulkhead': () => lanes('service')
    + track(rx('client'), cy('client'), lx('service'), cy('service'))
    + box(S.x, S.y + 4, S.w, 22, '核心池', C.block, C.ok, 5)
    + box(S.x, S.y + 32, S.w, 22, '非核心池', C.block, C.dim, 5)
    + showAt(box(S.x, S.y + 32, S.w, 22, '占满', C.block2, C.bad, 5) + outline(S.x, S.y + 32, S.w, 22, C.bad), 0.25, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 60, '核心照常', C.ok, 5), 0.35, 0.95)
    + req([0.03, 0.12], C.ok) + req([0.5, 0.6], C.ok)
    + caption('资源分池：一个池耗尽，别的照常 —— 故障不扩散'),

  'timeout-budget': () => lanes('service') + rail
    + showAt(text(L.client.x + L.client.w / 2, L.client.y + 20, '3s', C.hi, 7), 0.05, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 26, '2.4s', C.hi, 7), 0.2, 0.95)
    + showAt(text(L.store.x + L.store.w / 2, L.store.y + 34, '1.8s', C.hi, 7), 0.35, 0.95)
    + req([0.03, 0.14]) + down([0.16, 0.3])
    + showAt(text(S.x + S.w / 2, S.y + 58, '每层都比上一层短', C.dim, 5), 0.45, 0.95)
    + caption('一个预算逐层递减；剩的不够就别开始'),

  'dead-letter-queue': () => lanes('service')
    + track(rx('client'), cy('client'), lx('service'), cy('service'))
    + rows(S.x + 4, S.y + 6, S.w - 8, 5, 6, 2, C.block)
    + showAt(box(S.x + 4, S.y + 6, S.w - 8, 6, '', C.bad), 0.08, 0.5)
    + showAt(text(S.x + S.w / 2, S.y + 54, '毒消息堵住后面', C.bad, 5), 0.14, 0.5)
    + showAt(box(L.store.x + 6, L.store.y + 22, 34, 12, '死信', C.block, C.bad, 5.5), 0.56, 0.95)
    + packet(rx('service'), cy('service'), lx('store'), cy('store'), [0.52, 0.64], C.bad)
    + showAt(text(S.x + S.w / 2, S.y + 54, '挪走，队列放行', C.ok, 5), 0.6, 0.95)
    + caption('重试耗尽就挪进死信，别让一条堵住整条队列'),

  'delivery-semantics': () => lanes('service') + rail
    + packet(rx('client'), cy('client'), lx('service'), cy('service'), [0.04, 0.14])
    + packet(rx('client'), cy('client'), lx('service'), cy('service'), [0.3, 0.4])
    + showAt(text(rx('client') + 16, cy('client') - 12, '同一条 ×2', C.dim, 5), 0.2, 0.95)
    + showAt(outline(S.x + 2, S.y + 24, S.w - 4, 14, C.hi, '去重表'), 0.42, 0.95)
    + down([0.16, 0.28], C.ok)
    + showAt(text(S.x + S.w / 2, S.y + 56, '第二次直接跳过', C.ok, 5), 0.5, 0.95)
    + caption('投递是「至少一次」——「恰好一次」靠消费端幂等做出来'),

  'compensating-transaction': () => lanes('service')
    + box(S.x, S.y + 4, S.w, 12, '扣库存', C.block, C.ok, 5)
    + box(S.x, S.y + 20, S.w, 12, '扣款', C.block, C.ok, 5)
    + showAt(box(S.x, S.y + 36, S.w, 12, '建订单', C.block, C.bad, 5), 0.2, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 60, '失败', C.bad, 5.5), 0.3, 0.5)
    + showAt(box(S.x, S.y + 20, S.w, 12, '退款', C.block2, C.hi, 5), 0.56, 0.75)
    + showAt(box(S.x, S.y + 4, S.w, 12, '回补库存', C.block2, C.hi, 5), 0.78, 0.95)
    + caption('跨服务没有事务：失败时按相反顺序逐步补偿'),

  'graceful-shutdown': () => lanes('service') + rail
    + req([0.02, 0.12]) + req([0.14, 0.24])
    + showAt(text(S.x + S.w / 2, S.y + 10, '① 探针置失败', C.hi, 5), 0.28, 0.48)
    + showAt(text(S.x + S.w / 2, S.y + 26, '② 等被摘掉', C.hi, 5), 0.42, 0.66)
    + showAt(text(S.x + S.w / 2, S.y + 42, '③ 处理完手上的', C.hi, 5), 0.6, 0.84)
    + showAt(text(S.x + S.w / 2, S.y + 58, '④ 退出', C.ok, 5), 0.82, 0.97)
    + showAt(`<path d="M${rx('client') + 4} ${cy('client')} L${lx('service') - 2} ${cy('service')}" stroke="${C.bad}" stroke-width="0.8" stroke-dasharray="1.5 1.5"/>`, 0.5, 0.97)
    + caption('先摘流量、等负载均衡感知到，再关 —— 顺序反了就掉请求'),

  'health-check-truth': () => lanes('service')
    + track(rx('service'), cy('service'), lx('store'), cy('store'), true)
    + box(S.x, S.y + 6, S.w, 14, '存活', C.block, C.ok, 5.5)
    + box(S.x, S.y + 28, S.w, 14, '就绪', C.block, C.hi, 5.5)
    + showAt(text(L.store.x + L.store.w / 2, L.store.y + 34, '挂了', C.bad, 6), 0.2, 0.95)
    + showAt(outline(S.x, S.y + 28, S.w, 14, C.bad) + text(S.x + S.w / 2, S.y + 52, '摘流量·不重启', C.dim, 4.8), 0.34, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 22, '仍然存活', C.ok, 4.8), 0.5, 0.95)
    + caption('存活探针别查下游 —— 重启修不好别人家的数据库'),

  'canary-rollback': () => lanes('service') + rail
    + box(S.x, S.y + 6, S.w, 14, 'v1', C.block, C.dim, 5.5)
    + showAt(box(S.x, S.y + 28, S.w, 14, 'v2  1%', C.block, C.hi, 5), 0.12, 0.42)
    + showAt(box(S.x, S.y + 28, S.w, 14, 'v2  25%', C.block, C.hi, 5), 0.44, 0.62)
    + showAt(box(S.x, S.y + 28, S.w, 14, 'v2  错误率↑', C.block, C.bad, 4.8), 0.64, 0.82)
    + showAt(text(S.x + S.w / 2, S.y + 56, '自动回滚', C.ok, 5.5), 0.84, 0.97)
    + req([0.03, 0.12]) + req([0.5, 0.58])
    + caption('小比例放量、按指标自动回滚 —— 回滚要比发布更快'),

  // ── 性能与容量 ──────────────────────────────────────────────────────────
  'cache-stampede': () => lanes('store', { store: { label: '数据库' } })
    + track(rx('client'), cy('client'), S.x, S.y + 12)
    + track(rx('service'), cy('service'), lx('store'), cy('store'))
    + box(S.x, S.y + 6, S.w, 14, '缓存', C.block, C.dim, 5.5)
    + packet(rx('client'), cy('client'), S.x, S.y + 12, [0.04, 0.14], C.ok)
    + showAt(text(S.x + S.w / 2, S.y + 30, '过期', C.bad, 5.5), 0.28, 0.6)
    + packet(rx('client'), cy('client'), S.x, S.y + 12, [0.3, 0.4])
    + packet(rx('client'), cy('client'), S.x, S.y + 12, [0.36, 0.46])
    + down([0.42, 0.56], C.bad) + down([0.46, 0.6], C.bad)
    + showAt(outline(S.x, S.y + 26, S.w, 12, C.hi, '只放一个进'), 0.64, 0.95)
    + caption('热点键一过期，成百上千个请求同时去重建'),

  'multi-level-cache': () => lanes('service') + rail
    + box(S.x, S.y + 4, S.w, 13, 'L1 进程内', C.block, C.ok, 5)
    + box(S.x, S.y + 22, S.w, 13, 'L2 分布式', C.block, C.hi, 5)
    + packet(rx('client'), cy('client'), S.x, S.y + 10, [0.04, 0.13], C.ok)
    + packet(rx('client'), cy('client'), S.x, S.y + 10, [0.18, 0.27], C.ok)
    + packet(rx('client'), cy('client'), S.x, S.y + 28, [0.4, 0.5], C.hi)
    + down([0.62, 0.74])
    + showAt(text(S.x + S.w / 2, S.y + 56, 'L1 命中 90%+', C.dim, 5), 0.2, 0.95)
    + caption('本地挡住绝大部分；代价是各实例副本会不一致'),

  'connection-pool-exhaustion': () => lanes('service') + rail
    + rows(S.x + 4, S.y + 6, S.w - 8, 6, 5, 2, C.block, 0.5)
    + showAt(rows(S.x + 4, S.y + 6, S.w - 8, 6, 5, 2, C.bad, 0.85), 0.2, 0.95)
    + req([0.04, 0.12]) + req([0.12, 0.2]) + req([0.2, 0.28]) + req([0.3, 0.38])
    + showAt(text(S.x + S.w / 2, S.y + 52, '池满 → 全在排队', C.bad, 5), 0.34, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 62, '真因多半是慢查询/长事务', C.dim, 4.4), 0.52, 0.95)
    + caption('池满几乎不是池太小，是连接被占太久'),

  'n-plus-one': () => lanes('store') + rail
    + req([0.03, 0.11]) + down([0.12, 0.2])
    + showAt(down([0.24, 0.32], C.bad) + down([0.3, 0.38], C.bad) + down([0.36, 0.44], C.bad)
      + text(S.x + S.w / 2, S.y + 54, '1 + N 次查询', C.bad, 5), 0.22, 0.56)
    + showAt(down([0.66, 0.78], C.ok) + text(S.x + S.w / 2, S.y + 54, '合并成 1 次', C.ok, 5), 0.6, 0.95)
    + caption('取完列表又逐条查关联 —— 预加载或批量合并'),

  'request-coalescing': () => lanes('service') + rail
    + req([0.02, 0.1]) + req([0.06, 0.14]) + req([0.1, 0.18]) + req([0.14, 0.22])
    + showAt(outline(S.x, S.y + 20, S.w, 16, C.hi, '攒 10ms'), 0.22, 0.5)
    + down([0.54, 0.68], C.ok)
    + showAt(text(S.x + S.w / 2, S.y + 56, '四次 → 一次', C.ok, 5.5), 0.56, 0.95)
    + caption('短窗口内攒批一次发出：吞吐上去，延迟多等一点'),

  'cache-warmup': () => lanes('service') + rail
    + showAt(box(S.x, S.y + 6, S.w, 14, '新实例 · 缓存空', C.block, C.bad, 4.6), 0.05, 0.45)
    + showAt(down([0.14, 0.26], C.bad) + down([0.2, 0.32], C.bad) + down([0.26, 0.38], C.bad), 0.1, 0.45)
    + showAt(box(S.x, S.y + 6, S.w, 14, '预热完成', C.block, C.ok, 5), 0.52, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 34, '再放流量', C.hi, 5), 0.6, 0.95)
    + req([0.62, 0.72], C.ok)
    + caption('新实例缓存是空的：先预热再承接，否则扩容打垮库'),

  'backpressure': () => lanes('service') + rail
    + req([0.02, 0.1]) + req([0.08, 0.16]) + req([0.14, 0.22]) + req([0.2, 0.28]) + req([0.26, 0.34])
    + rows(S.x + 4, S.y + 8, S.w - 8, 5, 5, 2, C.block)
    + showAt(rows(S.x + 4, S.y + 8, S.w - 8, 5, 5, 2, C.bad, 0.8) + text(S.x + S.w / 2, S.y + 48, '队列满', C.bad, 5.5), 0.3, 0.62)
    + showAt(text(S.x + S.w / 2, S.y + 48, '503 快速拒绝', C.hi, 5.5), 0.66, 0.95)
    + back([0.68, 0.8], C.hi)
    + caption('有界队列＋快速拒绝；无界排队只是把拒绝推迟成 OOM'),

  'hot-cold-split': () => lanes('store') + rail
    + box(L.store.x + 5, L.store.y + 6, 36, 16, '热 30 天', C.block, C.hi, 5)
    + showAt(box(L.store.x + 5, L.store.y + 26, 36, 16, '冷 · 对象存储', C.block2, C.dim, 4.6), 0.1, 0.95)
    + req([0.03, 0.12]) + down([0.13, 0.24], C.ok)
    + showAt(text(S.x + S.w / 2, S.y + 56, '默认只查热层', C.ok, 5), 0.3, 0.95)
    + showAt(text(S.x + S.w / 2, S.y + 66, '查冷层要显式声明', C.dim, 4.4), 0.5, 0.95)
    + caption('别做透明回退 —— 那会让接口偶发慢几十倍且无法复现'),

  'load-test-baseline': () => lanes('service') + rail
    + text(S.x + S.w / 2, S.y + 4, '并发 →', C.dim, 5)
    + showAt(rows(S.x + 4, S.y + 40, 8, 1, 12, 0, C.ok) + rows(S.x + 16, S.y + 32, 8, 1, 20, 0, C.ok)
      + rows(S.x + 28, S.y + 26, 8, 1, 26, 0, C.ok), 0.1, 0.95)
    + showAt(rows(S.x + 40, S.y + 28, 8, 1, 24, 0, C.bad) + text(S.x + S.w / 2, S.y + 66, '拐点 = 容量', C.hi, 5), 0.5, 0.95)
    + req([0.03, 0.12]) + req([0.3, 0.38]) + req([0.5, 0.58])
    + caption('要的是一条曲线和那个拐点，不是一个「最大 QPS」'),

  'capacity-watermark': () => lanes('service') + rail
    + box(S.x + 12, S.y + 6, 30, 50, '', C.block2)
    + showAt(box(S.x + 12, S.y + 38, 30, 18, '', C.ok), 0.05, 0.4)
    + showAt(box(S.x + 12, S.y + 26, 30, 30, '', C.hi), 0.42, 0.66)
    + showAt(box(S.x + 12, S.y + 14, 30, 42, '', C.bad), 0.68, 0.95)
    + `<path d="M${S.x + 8} ${S.y + 26} l38 0" stroke="${C.hi}" stroke-width="0.7" stroke-dasharray="2 2"/>`
    + text(S.x + 52, S.y + 27, '60%', C.hi, 4.6, 'start')
    + `<path d="M${S.x + 8} ${S.y + 14} l38 0" stroke="${C.bad}" stroke-width="0.7" stroke-dasharray="2 2"/>`
    + text(S.x + 52, S.y + 15, '80%', C.bad, 4.6, 'start')
    + req([0.03, 0.12]) + req([0.4, 0.48]) + req([0.7, 0.78])
    + caption('水位线要按增长速率折算成「还剩几天」才可行动')
}
