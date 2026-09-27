/** Only explicit transport/rate errors; never infer from latency or model text. */
export function cliNetworkSignal(message:unknown):'network'|'rate-limit'|undefined {
 if(typeof message!=='string')return
 const text=message.slice(0,4000)
 if(/\b(?:MCP|tool|authentication|unauthorized|quota|billing|credit)\b/i.test(text))return
 if(/\brate_limit(?:_exceeded|_error)?\b|\bHTTP(?: status)?\s*429\b|\b429\s+Too Many Requests\b/i.test(text))return 'rate-limit'
 if(/\b(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ETIMEDOUT)\b|\bnetwork (?:connection )?(?:error|unreachable)\b/i.test(text))return 'network'
}
