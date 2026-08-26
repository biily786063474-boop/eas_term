# 动效短片核对

- **`核对清单.html`** —— 给人看的。用户点名的 17 个组件逐条根因 + 全部 145 条按
  「最长连续动」排序。浏览器打开。
- **`状态数据.json`** —— 给我看的。145 条的实测指标（有动占比 / 最长连续动 /
  开头静止 / 峰值差分 / 内容占舞台 / 四种交互各自动不动）。
  用户报某条不动时，先查这里对号，别从头再测一遍。

## 判据（踩过三轮才定下来）

| 指标 | 为什么不够 |
|---|---|
| 平均帧间差分 | 对**一次性效果**有偏 —— 逐字浮现只占前 1 秒、后面 5 秒静止，均值自然低 |
| 峰值帧间差分 | 只说明「曾经动过一下」。StackTransition 峰值 20，那是一次场景硬切，不是动画 |
| **最长连续动** | **这个才对得上肉眼。** 低于 0.5s 就是「闪一下」，hover 撞到的多半是静止画面 |

阈值取该片峰值的 8%（下限 0.08）：模拟指针一直在走，不能按「画面完全相同」判死；
不同片子亮度差很多，绝对阈值不稳。

## 播放层：编码必须是 AV1

**这台机器的 VP9 硬件解码路径是坏的。** 高度 ≥ 约 360 的片子在 `<video>` 里一律
`MEDIA_ERR_DECODE(code=3)`，低于阈值的反而正常（Chromium 小视频走软解、大视频走硬解）。
145 个里 41 个中招 —— 症状就是「有时候 hover 有动画、有时候没有」。
已全部转 AV1（dav1d 软解，不碰硬解路径），顺带 15.3MB → 12.0MB。
排查过程见 `scripts/dict-clips/README.md`。

## 只在参数变化时才动的组件

数字翻滚（`Counter`）这类，静态值永远不动。选型台的 `preview-overrides.json`
里可以给它配：

```json
"recordSweep": { "prop": "value", "fractions": [0.2, 0.75, 0.4], "gap": 1300 }
```

录制时会按这些比例**拖那一行的 scrubber**（参数面板里数值型参数不是 input，
是自定义拖动条，只能真拖）。Counter 实测 7%/0.28s → 29%/0.68s。

**试过但更差的**：隔 1.5s 重挂载一次填满整节 —— 五个样本全部变差
（BlurText 31%→11%），因为重挂载期间画面是空的。

## 已知修不掉的

| 组件 | 根因 |
|---|---|
| `Dither` 抖动 | 组件自己的 EffectComposer 后处理链，浏览器里就是冻的。已记进素材库 known-issues |
| `PixelTrail` 鼠标拖尾 | 着色器里 `trail = texture2D(mouseTrail,…).r` 恒为 1，整块画布被涂成一个颜色 —— 所以看着「拖尾和背景融合」。drei 的 `useTrailTexture` 初始把画布填黑，`.r` 本该是 0。有头/无头、加不加黑底都一样。词典里另一条「鼠标拖尾」（`Ribbons`）是好的 |
| `GlassSurface` 毛玻璃 / `ReflectiveCard` 液态金属 | 源码里**没有任何动画驱动点**，`continuous:false` —— 静止才是对的 |
| `ScrollFloat` / `ScrollReveal` | GSAP ScrollTrigger，选型台舞台不是可滚动容器，触发点在挂载时就过了 |

## 工具

```
node scripts/dict-clips/record.mjs <组件名> <输出目录>   # 重录（先起选型台）
scripts/dict-clips/audit-one.sh <webm>                  # 量平均/峰值差分
```

坑都记在 `scripts/dict-clips/README.md`。
