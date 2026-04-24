import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'

export interface HolderWalletRow {
  id: string
  personPrincipal: string
  privyEoa: string
  askarProfile: string
  linkSecretId: string
  status: 'active' | 'rotating' | 'revoked'
  createdAt: string
}

export function getHolderWalletByPrincipal(personPrincipal: string): HolderWalletRow | null {
  const row = db.prepare(
    `SELECT id, person_principal as personPrincipal, privy_eoa as privyEoa,
            askar_profile as askarProfile, link_secret_id as linkSecretId,
            status, created_at as createdAt
       FROM holder_wallets WHERE person_principal = ?`,
  ).get(personPrincipal) as HolderWalletRow | undefined
  return row ?? null
}

export function getHolderWalletById(id: string): HolderWalletRow | null {
  const row = db.prepare(
    `SELECT id, person_principal as personPrincipal, privy_eoa as privyEoa,
            askar_profile as askarProfile, link_secret_id as linkSecretId,
            status, created_at as createdAt
       FROM holder_wallets WHERE id = ?`,
  ).get(id) as HolderWalletRow | undefined
  return row ?? null
}

export function insertHolderWallet(row: Omit<HolderWalletRow, 'createdAt'>): HolderWalletRow {
  const createdAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO holder_wallets (id, person_principal, privy_eoa, askar_profile, link_secret_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.personPrincipal, row.privyEoa.toLowerCase(), row.askarProfile, row.linkSecretId, row.status, createdAt)
  return { ...row, createdAt }
}

export function newHolderWalletId(): string {
  return `holder_${randomUUID()}`
}

export function newLinkSecretId(): string {
  return `ls_${randomUUID()}`
}

export function askarProfileFor(personPrincipal: string): string {
  return `hw-${personPrincipal.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}
