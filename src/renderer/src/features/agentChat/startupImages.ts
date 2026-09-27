export function startupImageMessage(body: string, shots: {path:string;url:string}[], override?: string) {
 const text = override !== undefined ? override.trim() : body
 const images = override !== undefined ? [] : shots.map(({path,url})=>({path,url}))
 const prefix = images.map(i=>/\s/.test(i.path)?`"${i.path}"`:i.path).join(' ')
 return {payload:prefix ? (text ? `${prefix} ${text}` : prefix) : text,text,images}
}
