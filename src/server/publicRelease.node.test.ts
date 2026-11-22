// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkPublicBuild } from './checkPublicBuild.node.ts'
import { parseHeaders, readPublicHeaders } from './headers.node.ts'
import { EXCLUDED, personalPatterns, publicFiles, scanForPersonalInformation } from './publicCopy.node.ts'

const temporary: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pda-public-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('security headers of the public web version (sharing plan S6, finding A7)', () => {
  const headers = readPublicHeaders()
  const csp = headers['Content-Security-Policy'] ?? ''
  const directive = (name: string) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? ''

  it('allows only the app itself and the servers it needs', () => {
    expect(directive('default-src')).toBe("default-src 'self'")
    expect(directive('connect-src').split(' ').slice(1).sort()).toEqual(
      ["'self'", 'http://127.0.0.1:11434', 'http://localhost:11434', 'https://*.supabase.co', 'https://api.ynab.com', 'wss://*.supabase.co'].sort(),
    )
  })

  it('blocks eval, inline scripts, frames and plugins', () => {
    expect(directive('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
  })

  it('reads only the "/*" rule and ignores comments', () => {
    expect(parseHeaders('# note\n/other\n  A: 1\n/*\n  B: 2\n  # C: 3\n')).toEqual({ B: '2' })
  })
})

describe('public build check', () => {
  function build(files: Record<string, string>): string {
    const dir = tempDir()
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  it('passes a clean build', () => {
    const dir = build({ 'index.html': '<script type="module" src="/assets/a.js"></script>', 'assets/a.js': 'x="https://abcdefgh.supabase.co"', _headers: '/*' })
    expect(checkPublicBuild(dir)).toEqual([])
  })

  it('finds a built-in Supabase project, an inline script and missing headers', () => {
    // Built at run time so that this file itself contains no project address.
    const project = `${'abcdefghij'.repeat(2)}.supabase.co`
    const dir = build({ 'index.html': '<script>alert(1)</script>', 'assets/a.js': `u="https://${project}"` })
    const problems = checkPublicBuild(dir)
    expect(problems.some((problem) => problem.includes('Supabase project address'))).toBe(true)
    expect(problems.some((problem) => problem.includes('inline script'))).toBe(true)
    expect(problems.some((problem) => problem.includes('_headers'))).toBe(true)
  })
})

describe('clean public copy (sharing plan S0/S6, finding A8)', () => {
  it("leaves out the owner's notes, instructions and personal plans", () => {
    for (const file of ['PROJECT_NOTES.md', 'CLAUDE.md', 'docs/SHARING_PLAN.md', 'docs/HABIT_IMPORT.md', 'docs/SYNC_DESIGN.md']) {
      expect(EXCLUDED).toContain(file)
    }
    const files = publicFiles('.')
    expect(files).not.toContain('PROJECT_NOTES.md')
    expect(files).toContain('LICENSE')
    expect(files).toContain('docs/PRIVACY.md')
  })

  it('finds personal information in a sample (samples built at run time, so this file has none)', () => {
    const dir = tempDir()
    const sample = [
      `Ask ${['someone', 'gmail.com'].join('@')}`,
      `server ${'abcdefghij'.repeat(2)}.supabase.co`,
      'ok line',
      `${'/'}home/someone/x`,
      'Hello Zorglub',
    ].join('\n')
    writeFileSync(join(dir, 'a.md'), sample)
    expect(scanForPersonalInformation(dir, ['a.md'], personalPatterns(['zorglub']))).toEqual([
      'a.md:1: personal e-mail address',
      'a.md:2: Supabase project address',
      'a.md:4: home folder path',
      'a.md:5: owner word "zo…"',
    ])
  })

  it('the files that would be published contain no personal information', () => {
    expect(scanForPersonalInformation('.', publicFiles('.'))).toEqual([])
  })
})
