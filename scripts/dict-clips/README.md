# 动效词条短片：怎么重录

词典里 145 条动效词条（`fx-*`）hover 时播的是 `resources/dict-clips/*.webm` ——
**真组件跑出来的实录**，不是手画的示意图（内置那 162 条概念词条才是手画 SMIL，
生成器在 `scripts/dict-svg/`）。

## 编码必须是 AV1，不能是 VP9

**这台机器（Electron/Chromium）的 VP9 硬件解码路径是坏的。**
高度 ≥ 约 360 的片子在 `<video>` 里一律 `MEDIA_ERR_DECODE (code=3)`，
而低于阈值的反而正常 —— 因为 Chromium 对小视频走软解、大视频才走硬解。

实测 145 个里 41 个中招，症状就是用户报的「有时候 hover 能看到动画，有时候就没了」。
排查过程（每一步都是实测，不是推断）：

| 试过什么 | 结果 |
|---|---|
| ffmpeg 能不能解 | ✓ 能，所以文件本身没坏 |
| 是不是文件太大 | ✗ 12KB 的高片挂、79KB 的矮片好 |
| 是不是解码器数量上限 | ✗ 30 个一批也挂，同一批固定那几个 |
| 把好片的字节换个坏片的名字 | ✓ 能放 → 是内容问题不是路由问题 |
| 重新编码（换 GOP、关 alt-ref、补 pix_fmt） | ✗ 都救不回 |
| 逐级二分高度 | **356 能放、364 挂** |
| 同尺寸换 VP8 / AV1 | ✓ 都能放 |
| `--disable-accelerated-video-decode` 跑 VP9 | ✓ 全部正常 |

没选「全局关硬解」：那会让画布里网页节点播视频也走软解，代价太大。
AV1 走 dav1d 软解、不碰硬解路径，而且同画质更小（全量 15.3MB → 12.0MB）。

## 依赖

录制要跑起「动效选型台」，它在**另一个仓库**：

```
~/Biily/资产收集/交互动效        # 组件源码 + 选型台 + playwright
npm run dev                      # 起在 localhost:5199
```

`record.mjs` 直接从那个仓库 import playwright，所以本项目不需要装。

## 用法

```
node scripts/dict-clips/record.mjs <组件名> <输出目录>
node scripts/dict-clips/audit-one.sh resources/dict-clips/<组件名>.webm
```

审计输出四列：`名字 / 平均帧间差分 / 峰值帧间差分 / 字节数`。

## 判据：平均看不出问题，峰值才能

帧间差分是「画面到底有没有在变」——模拟指针只占 0.02% 像素，可以忽略。但：

- **平均差分对「一次性效果」有偏**。逐字浮现只占前 1 秒，后面 5 秒静止，
  均值自然低。用它筛会把好片当坏片。
- **峰值差分才回答「效果发生过没有」**。`StaggeredMenu` 均值 0.129，
  看着像正常；峰值只有 0.32，说明菜单从头到尾没展开过。修好后峰值 31.4。

所以两个都要看。峰值 < 0.35 基本就是「一帧都没动」。

## 2026-08-25 修了什么（用户报「hover/拖拽/点击特定区域的演示都是错的」）

1. **落点从「舞台固定比例」改成「瞄准真实元素」。**
   旧版把 hover/click 算成 `P(.28,.42)` 这种舞台比例，而 `SpotlightCard`
   `TiltedCard` `SpecularButton` 只占舞台一小块 —— 指针从旁边划过去，
   hover 态压根没触发，录出来是张静止的图。
2. **加了「拖拽」小节。** 旧版没有。`ElasticSlider`（拖滑杆）、
   `StickerPeel`（拖贴纸）、`Stack`/`DomeGallery`/`InfiniteMenu`（拖着转），
   核心动作就是拖，不拖等于没演。
3. **hover 从「斜穿一刀」改成「扫过边和内部」。**
   `BorderGlow` 是「靠近哪条边哪条亮」，只穿中间触发不到。
4. **触发方式不只信 `triggers` 字段。** `PixelTrail` 摘要写着「鼠标划过处逐格点亮」，
   触发却只标 mount；`RingCarousel`/`FlyingPosters` 写着「随滚轮流动」也没标 scroll。
   现在从摘要文本补推 hover/scroll/drag。
5. **入场类必须重放一次入场。** 选型台里组件一挂载就演完了，
   不重放的话录到的是静止终态（「文字掉落」整段都从「词块已经堆在底部」开始）。

## 几个反复踩的坑

- **取景框必须和舞台求交，交集为空要退回舞台。** 轮播卡片会滑到舞台外，
  直接算 min/max 得出负宽度，ffmpeg 报 -22 就挂了（实测 `crop=-174:480:...`）。
- **落点也要判是否在舞台内。** 取景救回来了、交互还打在空白页面上，
  比直接报错更难发现。
- **别用 `stdio:'ignore'` 吞 ffmpeg 的错误。** 挂了只看到「status: 234」，
  什么线索都没有。
- **macOS 没有 GNU 的 `timeout`**，而且 `cmd | tail` 之后的 `$?` 是 `tail` 的退出码 ——
  第一版批量脚本因此 63 条一条没录、还退出码 0。
- **可点元素的尺寸下限不能设太大。** `StaggeredMenu` 的 Menu 按钮是 63×**14**，
  下限 16 正好把它筛掉，于是菜单永远没被点开。

## 选型台侧也改了（在那个仓库里）

`playground/preview-overrides.json`：

- `FallingText` —— 源码 `text` 默认空串，不传就一个词块都没有、舞台全黑
- `StarBorder` —— 没有 children 就是一颗空药丸
- `Dither`/`DarkVeil`/`SideRays`/`LightPillar` 等 —— 默认速度是按「几分钟的背景」
  调的，几秒的缩略图里看不出在动，只调预览参数、不动源码默认值

`scripts/known-issues.json` 记了 `Dither`：它在浏览器里就是冻的
（连续两次 `toDataURL()` 字节相同），嫌疑在 `EffectComposer` 后处理链，未解。
