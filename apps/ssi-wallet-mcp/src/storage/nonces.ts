import { db } from '../db/index.js'

/** Atomic "mark nonce as used" — throws if already seen. */
export function consumeNonce(nonce: string, actionType: string, holderWalletId: string, expiresAt: bigint): void {
  try {
    db.prepare(
      `INSERT INTO action_nonces (nonce, action_type, holder_wallet_id, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(nonce, actionType, holderWalletId, Number(expiresAt), new Date().toISOString())
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (/UNIQUE constraint/.test(msg)) {
      throw new Error('nonce already used')
    }
    throw err
  }
}
