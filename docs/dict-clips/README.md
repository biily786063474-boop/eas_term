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
| `PixelTrail` 鼠标拖尾 | 组件坏了，**已改成手画 SMIL**，见下 |

## 组件坏了怎么办：换成手画图

`PixelTrail`（鼠标拖尾）的着色器里 `trail = texture2D(mouseTrail,…).r` **恒为 1**，
整块画布被涂成一个颜色 —— 所以用户看到的是「拖尾和背景融合」。

排除法做到底了，三条路都试过：

| 试过 | 结果 |
|---|---|
| 换背景（给画布父层加深色底，确认 `bg=rgb(7,8,12)` 已生效） | ✗ 画布仍是实心 |
| 换拖尾颜色（`color` 改成青绿） | ✗ **整块**跟着变色，因为底色就是 `pixelColor` |
| **全程不碰鼠标截图** | **画布已经是实心** —— 从一开始就没有「拖尾/非拖尾」之分 |

所以既不是背景问题也不是颜色问题：drei 的 `useTrailTexture` 没把纹理绑进 uniform，
采样恒返回白色。

改用**手画 SMIL** 替代（`scripts/dict-svg/batch-i.mjs`），
用 `scripts/dict-svg/swap-to-svg.mjs` 把词条从 `clip` 换成 `svg`。
**DictView 里 clip 优先于 svg，所以必须把 clip 删掉**，只加 svg 不生效。

要退回短片：`git revert` 那个提交即可，webm 还在 git 历史里。
| `GlassSurface` 毛玻璃 / `ReflectiveCard` 液态金属 | 源码里**没有任何动画驱动点**，`continuous:false` —— 静止才是对的 |
| `ScrollFloat` / `ScrollReveal` | GSAP ScrollTrigger，选型台舞台不是可滚动容器，触发点在挂载时就过了 |

## 工具

```
node scripts/dict-clips/record.mjs <组件名> <输出目录>   # 重录（先起选型台）
scripts/dict-clips/audit-one.sh <webm>                  # 量平均/峰值差分
```

坑都记在 `scripts/dict-clips/README.md`。
