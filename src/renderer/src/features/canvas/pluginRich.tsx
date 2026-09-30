// 词典文案里的轻量内联标记：<b>…</b>、<code>…</code>、<br>，渲染成对应元素。
// 只认这三种；其余字符（含 <server> 这类尖括号）原样输出。
import type { ReactNode } from 'react'

export function rich(text: string): ReactNode[] {
  return text.split(/(<b>.*?<\/b>|<code>.*?<\/code>|<br>)/gs).map((part, i) => {
    if (part === '<br>') return <br key={i} />
    if (part.startsWith('<b>')) return <b key={i}>{part.slice(3, -4)}</b>
    if (part.startsWith('<code>')) return <code key={i}>{part.slice(6, -7)}</code>
    return part
  })
}
