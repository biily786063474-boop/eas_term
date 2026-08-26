// skills/eas-term/generate.md 的内容守卫。
//
// 这些句子删掉不会有任何报错 —— app 照常构建、照常分发，外部 agent 照常丢图。
// 2026-08-26 上游（画板 1.21.29）修的就是这类静默失败：视频节点连了参考图但漏传
// `mode`，系统按模型第一个模式兜底成 t2v，图被丢掉，**而报价一分不差**
// （实测 823 → 823），从返回值里看不出来，只能等成片出来发现跟参考图无关。
//
// 本文件守的是「那次教训还写在文档里」。上游同一 commit 也加了同款守卫
// （taptv pad 的 test-mode-compat.mjs 第 5 组），两边各守各的分发路径。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const doc = readFileSync(
  fileURLToPath(new URL('../../skills/eas-term/generate.md', import.meta.url)),
  'utf8'
)

// 每条都对应一个曾经真实发生、且**不会报错**的失败
const MUST_KEEP: Array<[string, string]> = [
  ['视频节点连了媒体必须传 mode', 'mode'],
  ['说清楚漏传时兜底到 t2v', 't2v'],
  ['点名 i2v', 'i2v'],
  ['价格陷阱的实测数字（唯一能证明"看不出来"的证据）', '823'],
  ['自检判据：换纯文生模式对照报价', '价格没变'],
  ['modes[].inputs 才算数，不是模型级 inputs', 'modes[].inputs'],
  ['硬拦的错误码，撞上了才知道是这回事', 'MODE_REJECTS_MEDIA_INPUT'],
  ['自证字段', 'resolved_mode'],
  ['澄清 media_ref_map 不是媒体进请求的证据', 'media_ref_map']
]

for (const [why, needle] of MUST_KEEP) {
  test(`generate.md 保留：${why}`, () => {
    assert.ok(
      doc.includes(needle),
      `generate.md 里找不到 ${JSON.stringify(needle)}。\n` +
        `这不是格式问题 —— 少了它外部 agent 会重蹈 2026-08-26 那次静默丢图。\n` +
        `确实要改措辞的话，连这条断言一起改，别只删文档。`
    )
  })
}

test('图片那条价格判据没被扩大到视频', () => {
  // 图片链路「价格涨了 = 带上了图」成立（138 → 179），视频上直接失效。
  // 这两句必须同时在场，否则 agent 会把图片经验搬到视频上 —— 那正是上游 commit
  // 里点破的心智模型来源。
  assert.ok(doc.includes('179'), '图片链路的对照数字（138 → 179）丢了')
  assert.ok(
    /判据\s*3\s*只对图片有效/.test(doc),
    '少了「判据 3 只对图片有效，视频上直接失效」的限定 —— ' +
      '没有它，那三条判据读起来像是通用的'
  )
})
