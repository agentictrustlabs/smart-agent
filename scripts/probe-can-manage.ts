/**
 * One-shot probe: does canManageAgent(paMaria, network) return true?
 * Run via: cd apps/web && pnpm exec tsx ../../scripts/probe-can-manage.ts
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

async function main() {
  const { canManageAgent, getOrgsForPersonAgent } = await import(
    path.join(repoRoot, 'apps/web/src/lib/agent-registry.ts')
  )
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (p: string) => { prepare: (sql: string) => { get: () => any }, close: () => void } }).default
  const db = new Database(path.join(repoRoot, 'apps/web/local.db'))
  const u = db.prepare(`SELECT person_agent_address FROM users WHERE id='cat-user-001'`).get() as { person_agent_address: string }
  db.close()
  const network = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b'
  console.log('Maria pa:', u.person_agent_address)
  console.log('Network :', network)
  const orgs = await getOrgsForPersonAgent(u.person_agent_address)
  console.log('orgs for paMaria:', JSON.stringify(orgs, null, 2))
  const can = await canManageAgent(u.person_agent_address, network)
  console.log('canManageAgent:', can)
}
main().catch(e => { console.error(e); process.exit(1) })
