import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'

export interface HolderWalletRow {
  id: string
  personPrincipal: string
  walletContext: string
  privyEoa: string
  askarProfile: string
  linkSecretId: string
  status: 'active' | 'rotating' | 'revoked'
  createdAt: string
}

const SELECT_COLS = `
  id,
  person_principal as personPrincipal,
  wallet_context   as walletContext,
  privy_eoa        as privyEoa,
  askar_profile    as askarProfile,
  link_secret_id   as linkSecretId,
  status,
  created_at       as createdAt
`

/** Look up the holder wallet for a (principal, context) pair. */
export function getHolderWalletByContext(personPrincipal: string, walletContext: string): HolderWalletRow | null {
  const row = db.prepare(
    `SELECT ${SELECT_COLS} FROM holder_wallets
     WHERE person_principal = ? AND wallet_context = ?`,
  ).get(personPrincipal, walletContext) as HolderWalletRow | undefined
  return row ?? null
}

/** All wallets for a principal — used by the UI wallet-switcher. */
export function listHolderWalletsForPrincipal(personPrincipal: string): HolderWalletRow[] {
  return db.prepare(
    `SELECT ${SELECT_COLS} FROM holder_wallets
     WHERE person_principal = ? ORDER BY created_at`,
  ).all(personPrincipal) as HolderWalletRow[]
}

export function getHolderWalletById(id: string): HolderWalletRow | null {
  const row = db.prepare(
    `SELECT ${SELECT_COLS} FROM holder_wallets WHERE id = ?`,
  ).get(id) as HolderWalletRow | undefined
  return row ?? null
}

export function insertHolderWallet(row: Omit<HolderWalletRow, 'createdAt'>): HolderWalletRow {
  const createdAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO holder_wallets
       (id, person_principal, wallet_context, privy_eoa, askar_profile, link_secret_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.personPrincipal,
    row.walletContext,
    row.privyEoa.toLowerCase(),
    row.askarProfile,
    row.linkSecretId,
    row.status,
    createdAt,
  )
  return { ...row, createdAt }
}

/** Rotate the active link secret for a wallet — sets new link_secret_id. */
export function updateHolderLinkSecret(walletId: string, newLinkSecretId: string): void {
  db.prepare(`UPDATE holder_wallets SET link_secret_id = ? WHERE id = ?`)
    .run(newLinkSecretId, walletId)
}

export function newHolderWalletId(): string {
  return `holder_${randomUUID()}`
}

export function newLinkSecretId(): string {
  return `ls_${randomUUID()}`
}

export function askarProfileFor(personPrincipal: string, walletContext: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `hw-${safe(personPrincipal)}-${safe(walletContext)}`
}

/**
 * Normalize a walletContext string. Returns null if invalid.
 *
 * Rules:
 *   - non-empty, ≤ 32 chars
 *   - lowercase-folded (Personal == personal)
 *   - only [a-z0-9_-]
 *
 * Enforced at the wallet layer so the SAME canonical string reaches
 * the DB, the Askar profile, and every downstream audit — prevents
 * case/spelling drift from creating parallel shadow wallets.
 */
export function normalizeWalletContext(raw: string | undefined): string | null {
  if (!raw) return 'default'
  const s = raw.trim().toLowerCase()
  if (s.length === 0 || s.length > 32) return null
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(s)) return null
  return s
}
