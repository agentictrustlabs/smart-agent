import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

/**
 * AES-GCM encryption-at-rest for pg_communities (ADR-PG-1).
 *
 * v1 implementation: per-row 32-byte DEK encrypted under a per-principal
 * KEK derived deterministically from a deployment-wide master + the principal
 * address. Phase-2 will move the KEK into Askar (mirroring person-mcp's
 * profile-key pattern).
 */

const ALGO = 'aes-256-gcm'
const KEY_LEN = 32
const IV_LEN = 12

const MASTER_KEY = (() => {
  const fromEnv = process.env.PEOPLE_GROUP_ENC_MASTER_KEY
  if (fromEnv && /^[a-f0-9]{64}$/i.test(fromEnv)) {
    return Buffer.from(fromEnv, 'hex')
  }
  // Dev fallback: derived deterministically from a fixed string. In prod
  // the master key MUST come from env or a KMS — never this fallback.
  return createHash('sha256').update('smart-agent-people-group-dev-master-key-v1').digest()
})()

function deriveKekForPrincipal(principal: string): Buffer {
  return createHash('sha256').update(MASTER_KEY).update(':').update(principal.toLowerCase()).digest()
}

export interface EncryptedColumns {
  displayNameCt: Buffer
  cohesionBasisCt: Buffer | null
  locationHintCt: Buffer | null
  encDek: Buffer
  encIv: Buffer
}

export interface CommunityPlaintext {
  displayName: string
  cohesionBasis?: string | null
  locationHint?: string | null
}

export function encryptCommunity(args: {
  principal: string
  plaintext: CommunityPlaintext
}): EncryptedColumns {
  const dek = randomBytes(KEY_LEN)
  const dekIv = randomBytes(IV_LEN)
  // Wrap DEK under per-principal KEK.
  const kek = deriveKekForPrincipal(args.principal)
  const wrap = createCipheriv(ALGO, kek, dekIv)
  const wrapped = Buffer.concat([wrap.update(dek), wrap.final(), wrap.getAuthTag()])

  const encField = (s: string | null | undefined): Buffer | null => {
    if (s == null) return null
    const iv = randomBytes(IV_LEN)
    const c = createCipheriv(ALGO, dek, iv)
    const ct = Buffer.concat([c.update(s, 'utf8'), c.final(), c.getAuthTag()])
    // Format on disk: iv || ct (ct includes the GCM tag).
    return Buffer.concat([iv, ct])
  }

  return {
    displayNameCt: encField(args.plaintext.displayName)!,
    cohesionBasisCt: encField(args.plaintext.cohesionBasis ?? null),
    locationHintCt: encField(args.plaintext.locationHint ?? null),
    encDek: wrapped,
    encIv: dekIv,
  }
}

export function decryptCommunity(args: {
  principal: string
  enc: {
    displayNameCt: Buffer
    cohesionBasisCt: Buffer | null
    locationHintCt: Buffer | null
    encDek: Buffer
    encIv: Buffer
  }
}): CommunityPlaintext {
  const kek = deriveKekForPrincipal(args.principal)
  // Unwrap DEK.
  const wrappedDekTag = args.enc.encDek.subarray(args.enc.encDek.length - 16)
  const wrappedDekCt = args.enc.encDek.subarray(0, args.enc.encDek.length - 16)
  const unwrap = createDecipheriv(ALGO, kek, args.enc.encIv)
  unwrap.setAuthTag(wrappedDekTag)
  const dek = Buffer.concat([unwrap.update(wrappedDekCt), unwrap.final()])

  const decField = (b: Buffer | null): string | null => {
    if (b == null) return null
    const iv = b.subarray(0, IV_LEN)
    const tag = b.subarray(b.length - 16)
    const ct = b.subarray(IV_LEN, b.length - 16)
    const d = createDecipheriv(ALGO, dek, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  }

  return {
    displayName: decField(args.enc.displayNameCt)!,
    cohesionBasis: decField(args.enc.cohesionBasisCt),
    locationHint: decField(args.enc.locationHintCt),
  }
}
