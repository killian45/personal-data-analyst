/**
 * Checks the public build (dist-public) before it is published (sharing
 * plan S6). Fails (exit code 1) if:
 * - a Supabase project address is built in (the owner's server must never
 *   be in the public version: it is built with empty VITE_SUPABASE_*);
 * - index.html contains an inline script (the security policy would block
 *   it, and inline scripts are what that policy protects against);
 * - the security headers file is missing.
 * Run by "npm run build:public".
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A real Supabase project address: a 20-character project reference. */
export const PROJECT_ADDRESS = /\b[a-z0-9]{20}\.supabase\.(co|in)\b/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

export function checkPublicBuild(dir: string): string[] {
  const problems: string[] = []
  if (!existsSync(join(dir, 'index.html'))) return [`${dir}/index.html is missing: build first.`]
  for (const path of files(dir).filter((file) => /\.(js|html|json|webmanifest)$/.test(file))) {
    const match = PROJECT_ADDRESS.exec(readFileSync(path, 'utf8'))
    if (match) problems.push(`${path} contains a Supabase project address (${match[0]}).`)
  }
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    if (!/\bsrc=/.test(tag)) problems.push(`index.html has an inline script: ${tag}`)
  }
  if (!existsSync(join(dir, '_headers'))) problems.push(`${dir}/_headers (security headers) is missing.`)
  return problems
}

if (process.argv[1]?.endsWith('checkPublicBuild.node.ts')) {
  const dir = process.argv[2] ?? 'dist-public'
  const problems = checkPublicBuild(dir)
  for (const problem of problems) console.error(`PROBLEM: ${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log(`${dir}: no built-in server, no inline script, security headers present.`)
}
