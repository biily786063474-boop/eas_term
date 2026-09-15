// 把 zip buffer 逐条解压到目标目录。**零 electron**：只用 yauzl + fs，`node --test` 可裸跑。
// 从 pluginMarket 抽出来单独可测（解压是安全要害：zip-slip / 软链逃逸 / zip bomb 都在这一关）。
//
// 三条防线：
//   · zip-slip —— 每个条目名过 safeExtractTarget，解压目标必须仍在 dest 内，越界拒整包
//   · 软链逃逸 —— 不还原软链，只把条目内容当普通文件写字节（软链 mode 被忽略即中和）
//   · zip bomb —— 限制条目数与解压总字节，超限拒整包
import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'
import { safeExtractTarget } from './pluginInstall.ts'

export interface ExtractLimits {
  maxEntries: number
  maxBytes: number
}
export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxEntries: 5000,
  maxBytes: 50 * 1024 ** 2
}

export function extractZip(buf: Buffer, dest: string, limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err || new Error('zip 打不开'))
        return
      }
      let entries = 0
      let bytes = 0
      let settled = false
      const fail = (e: Error): void => {
        if (settled) return
        settled = true
        try {
          zip.close()
        } catch {
          /* ignore */
        }
        reject(e)
      }
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return
        if (++entries > limits.maxEntries) {
          fail(new Error('包内文件过多,已拒'))
          return
        }
        const name = entry.fileName
        const target = safeExtractTarget(name.replace(/\/+$/, ''), dest)
        if (target === null) {
          fail(new Error(`包内路径越界:${name}`))
          return
        }
        if (name.endsWith('/')) {
          try {
            fs.mkdirSync(target, { recursive: true })
          } catch (e) {
            fail(e as Error)
            return
          }
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) {
            fail(e2 || new Error('读 zip 条目失败'))
            return
          }
          try {
            fs.mkdirSync(path.dirname(target), { recursive: true })
          } catch (e) {
            fail(e as Error)
            return
          }
          const ws = fs.createWriteStream(target)
          stream.on('data', (c: Buffer) => {
            bytes += c.length
            if (bytes > limits.maxBytes) {
              try {
                stream.destroy()
              } catch {
                /* ignore */
              }
              fail(new Error('解压体积超上限,已拒'))
            }
          })
          stream.on('error', (e: Error) => fail(e))
          ws.on('error', (e: Error) => fail(e))
          ws.on('close', () => {
            if (!settled) zip.readEntry()
          })
          stream.pipe(ws)
        })
      })
      zip.on('end', () => {
        if (!settled) {
          settled = true
          resolve()
        }
      })
      zip.on('error', (e: Error) => fail(e))
      zip.readEntry()
    })
  })
}
