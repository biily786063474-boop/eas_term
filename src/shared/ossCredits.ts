// 开源致谢（设置 → 关于与开源致谢）+ 第三方许可清单的「人工那一半」。
//
// 用户 2026-09-29：「要致敬一下软件里借鉴的开源库」→「这些在我的软件里是否违反他们的协议」。
// 当天拆正式版 app.asar + 读上游许可原文核过：没有「不许用却用了」，但缺声明——
// Vite 打进 JS 的库许可注释被删、Electron / Chromium 许可没进 Mac 包、sherpa-onnx 没附 Apache 原文、
// SenseVoice 模型协议要求「标明来源和作者、保留模型名」而界面里没有。
// 机器能收的（npm 包）由 scripts/gen-third-party-notices.mjs 在构建时自动收；
// 这里只放**不是 npm 包、或需要特别说明用途**的几项。改这里不用改脚本。
//
// ⚠️ React Bits 是「MIT + Commons Clause」不是 MIT：可以作为产品的一部分使用（含商用），
//    **不得再分发组件本身**。本产品只有效果名、自写提示词、组件运行的录像（resources/dict-clips），
//    看板层叠滚动是照思路自写（board/useBoardScroll.ts）——别把组件源码拷进来。

export type OssCredit = {
  name: string
  author: string
  /** 在 Eas-Term 里做什么（给用户看的一句话） */
  role: string
  license: string
  url: string
  /** 放在最前面的「真正借鉴」 */
  featured?: boolean
  /** 许可原文在包里的位置（相对 Resources），没有则只列名 */
  licenseFile?: string
}

export const OSS_CREDITS: OssCredit[] = [
  { name: 'oh-my-pi', author: 'Can Bölük，基于 Mario Zechner 的 pi', role: '内置的「原生 Harness」就是它（随包分发固定版本，按清单校验 SHA-256）',
    license: 'MIT', url: 'https://github.com/can1357/oh-my-pi', featured: true, licenseFile: 'omp/THIRD-PARTY-NOTICES.txt' },
  { name: 'React Bits', author: 'David Haz', role: '创作参考里 139 个动效词条的原型（演示片段是组件运行的录像），看板层叠滚动的思路',
    license: 'MIT + Commons Clause', url: 'https://github.com/DavidHDev/react-bits', featured: true },
  { name: 'Electron', author: 'OpenJS Foundation 与贡献者', role: '应用本体', license: 'MIT（Chromium 各组件见其许可清单）',
    url: 'https://github.com/electron/electron', licenseFile: 'licenses/electron-LICENSE.txt' },
  { name: 'xterm.js', author: 'The xterm.js authors', role: '终端显示', license: 'MIT', url: 'https://github.com/xtermjs/xterm.js' },
  { name: 'node-pty', author: 'Microsoft', role: '终端进程', license: 'MIT', url: 'https://github.com/microsoft/node-pty' },
  { name: 'Konva', author: 'Anton Lavrenov', role: '无限画布', license: 'MIT', url: 'https://github.com/konvajs/konva' },
  { name: 'CodeMirror', author: 'Marijn Haverbeke', role: '代码与对比视图', license: 'MIT', url: 'https://github.com/codemirror/dev' },
  { name: 'Model Context Protocol SDK', author: 'Anthropic', role: '把画布工具提供给 AI', license: 'MIT', url: 'https://github.com/modelcontextprotocol/typescript-sdk' },
  { name: '<model-viewer>', author: 'Google', role: '3D 模型预览（首次使用时下载）', license: 'Apache-2.0', url: 'https://github.com/google/model-viewer',
    licenseFile: 'licenses/Apache-2.0.txt' },
  { name: 'sherpa-onnx', author: 'k2-fsa / Next-gen Kaldi', role: '本地语音转文字引擎', license: 'Apache-2.0', url: 'https://github.com/k2-fsa/sherpa-onnx',
    licenseFile: 'licenses/Apache-2.0.txt' },
  { name: 'dependency-cruiser', author: 'Sander Verweij', role: '代码地图的依赖分析', license: 'MIT', url: 'https://github.com/sverweij/dependency-cruiser' }
]

/** 首次使用语音时从上游下载的模型（不随包分发，但协议要求署名） */
export const MODEL_CREDITS: OssCredit[] = [
  { name: 'SenseVoice（SenseVoiceSmall）', author: '阿里巴巴通义实验室 FunAudioLLM / FunASR；sherpa-onnx 转换版由 csukuangfj 发布',
    role: '语音识别模型', license: 'FunASR Model Open Source License 1.1', url: 'https://huggingface.co/FunAudioLLM/SenseVoiceSmall',
    licenseFile: 'licenses/FunASR-MODEL_LICENSE.txt' },
  { name: 'Silero VAD', author: 'Silero Team', role: '说话检测（什么时候开始、停下）', license: 'MIT', url: 'https://github.com/snakers4/silero-vad' },
  // 2026-09-29 查 Hugging Face：这个转换版没有单独声明许可，照实写，不替它编
  { name: 'Zipformer 流式中文识别模型', author: 'k2-fsa / Next-gen Kaldi；sherpa-onnx 转换版由 csukuangfj 发布', role: '边说边出字的流式识别',
    license: '上游未单独声明', url: 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13' }
]
