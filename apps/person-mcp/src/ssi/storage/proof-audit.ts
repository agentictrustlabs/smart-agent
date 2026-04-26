import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'

export interface ProofAuditRow {
  id: string
  holderWalletId: string
  principal: string
  counterpartyId: string
  policyId: string
  blockPin: string
  publicSetCommit: `0x${string}`
  evidenceCommit: `0x${string}`
  score: number
  sharedCount: number
  outputKind: 'score-only' | 'predicate' | 'full'
  createdAt: string
}

export function insertProofAudit(
  row: Omit<ProofAuditRow, 'id' | 'createdAt' | 'outputKind'> & {
    outputKind?: ProofAuditRow['outputKind']
  },
): ProofAuditRow {
  const id = `audit_${randomUUID()}`
  const createdAt = new Date().toISOString()
  const outputKind = row.outputKind ?? 'score-only'
  db.prepare(
    `INSERT INTO trust_overlap_audit
       (id, holder_wallet_id, principal, counterparty_id, policy_id, block_pin,
        public_set_commit, evidence_commit, score, shared_count, output_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, row.holderWalletId, row.principal, row.counterpartyId, row.policyId, row.blockPin,
    row.publicSetCommit, row.evidenceCommit, row.score, row.sharedCount, outputKind, createdAt,
  )
  return { id, ...row, outputKind, createdAt }
}

export function listProofAuditByPrincipal(principal: string, limit = 200): ProofAuditRow[] {
  return db.prepare(
    `SELECT id,
            holder_wallet_id   as holderWalletId,
            principal,
            counterparty_id    as counterpartyId,
            policy_id          as policyId,
            block_pin          as blockPin,
            public_set_commit  as publicSetCommit,
            evidence_commit    as evidenceCommit,
            score, shared_count as sharedCount,
            output_kind        as outputKind,
            created_at         as createdAt
       FROM trust_overlap_audit
      WHERE principal = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  ).all(principal, limit) as ProofAuditRow[]
}
