import http from 'node:http'
import https from 'node:https'
import { encodeReport, type Report } from './core.ts'
export const ENDPOINT = 'https://eas.biily.top/diagnostics/v1/reports'
export async function sendWithConsent(report: Report, confirm: () => Promise<boolean>, send: (r: Report) => Promise<string>): Promise<string | null> {
  return await confirm() ? send(report) : null
}
export async function sendReport(report: Report, options: { url?: string; allowLoopback?: boolean; timeout?: number } = {}): Promise<string> {
  const url = new URL(options.url ?? ENDPOINT)
  if (url.protocol !== 'https:' && !(options.allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('HTTPS required')
  const body = encodeReport(report)
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length } })
    const timer = setTimeout(() => req.destroy(new Error('timeout')), options.timeout ?? 15000)
    let done = false
    const finish = (error?: Error, id?: string): void => {
      if (done) return; done = true; clearTimeout(timer)
      if (error) reject(error); else resolve(id!)
    }
    req.on('error', () => finish(new Error('upload failed or timeout')))
    req.on('response', res => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.destroy(); finish(new Error(`HTTP ${res.statusCode}`)); return }
      let bytes = 0; const chunks: Buffer[] = []
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > 4096) { res.destroy(); finish(new Error('receipt too large')); return }
        chunks.push(Buffer.from(chunk))
      })
      res.on('error', () => finish(new Error('receipt interrupted')))
      res.on('end', () => {
        try {
          const receipt = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (receipt.ok !== true || receipt.id !== report.id) throw new Error('invalid receipt')
          finish(undefined, report.id)
        } catch { finish(new Error('invalid receipt')) }
      })
    })
    req.end(body)
  })
}
