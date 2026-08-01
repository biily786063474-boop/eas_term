// .env 文本解析。**主进程和渲染层共用同一份**，别各写各的 ——
// 两边解析规则不一致时，用户会遇到「粘贴认出 3 个、从文件导入认出 2 个」这种鬼故事。
//
// 认这些写法（云控制台「复制凭证」给的基本都在里面）：
//   FOO=bar            export FOO=bar
//   FOO="bar baz"      FOO='bar baz'
//   # 注释行、空行、认不出的行一律跳过，不报错

export interface ParsedEnvVar {
  varName: string
  value: string
}

export function parseEnvText(text: string): ParsedEnvVar[] {
  const out: ParsedEnvVar[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const varName = line.slice(0, eq).trim()
    // 环境变量名的合法字符。不挡的话注入时会拼出一个 shell 认不出的 env
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) continue
    if (seen.has(varName)) continue // 同名只取第一个，和 shell 的 source 行为一致
    let value = line.slice(eq + 1).trim()
    const q = value[0]
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) value = value.slice(1, -1)
    if (!value) continue // 空值没有存的意义，还会让「密钥值不能为空」的校验莫名其妙地报错
    seen.add(varName)
    out.push({ varName, value })
  }
  return out
}
