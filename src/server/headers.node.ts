/**
 * Reads public/_headers (Cloudflare Pages format) for the "/*" rule, so
 * "npm run preview:public" serves the public build with the same security
 * headers as the website (sharing plan S6).
 */
import { readFileSync } from 'node:fs'

export const HEADERS_PATH = 'public/_headers'

/** The headers of the "/*" rule: "  Name: value" lines under a "/*" line; comments ignored. */
export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  let inRule = false
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      inRule = line.trim() === '/*'
      continue
    }
    if (!inRule) continue
    const colon = line.indexOf(':')
    if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return headers
}

export function readPublicHeaders(path = HEADERS_PATH): Record<string, string> {
  return parseHeaders(readFileSync(path, 'utf8'))
}
