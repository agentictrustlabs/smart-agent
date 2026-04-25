/**
 * Parse a WebAuthn attestationObject → COSE_Key → (x, y) P-256 public key.
 *
 * Layout:
 *   attestationObject = CBOR-encoded { "fmt": str, "attStmt": ..., "authData": bytes }
 *   authData          = rpIdHash(32) | flags(1) | signCount(4) | attestedCredentialData | extensions?
 *   attestedCredentialData
 *                     = aaguid(16) | credentialIdLen(2) | credentialId | credentialPublicKey(COSE_Key)
 *   COSE_Key for ES256 = CBOR map with keys:
 *                          1 (kty) = 2 (EC2)
 *                          3 (alg) = -7 (ES256)
 *                         -1 (crv) = 1 (P-256)
 *                         -2 (x)   = 32-byte buffer
 *                         -3 (y)   = 32-byte buffer
 *
 * We decode only what's needed. No dependency on a CBOR lib — we walk
 * the bytes inline. This keeps it portable to edge/middleware environments.
 */

export interface ParsedAttestation {
  credentialId: Uint8Array
  credentialIdBase64Url: string
  pubKeyX: bigint
  pubKeyY: bigint
  aaguid: Uint8Array
  signCount: number
  flagAttestedCredentialData: boolean
  flagUserPresent: boolean
  flagUserVerified: boolean
}

export function parseAttestationObject(attestationObject: Uint8Array): ParsedAttestation {
  const top = cborDecode(attestationObject)
  if (!isMap(top)) throw new Error('attestationObject: expected CBOR map')
  const authData = mapGet(top, 'authData') as Uint8Array | undefined
  if (!(authData instanceof Uint8Array)) throw new Error('attestationObject: missing authData')

  return parseAuthData(authData)
}

export function parseAuthData(authData: Uint8Array): ParsedAttestation {
  if (authData.length < 37) throw new Error('authData too short')
  const flags = authData[32]
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)
  const flagUP = (flags & 0x01) !== 0
  const flagUV = (flags & 0x04) !== 0
  const flagAT = (flags & 0x40) !== 0
  if (!flagAT) {
    throw new Error('authData: attested credential data flag not set')
  }
  let i = 37
  const aaguid = authData.slice(i, i + 16); i += 16
  const credIdLen = (authData[i] << 8) | authData[i + 1]; i += 2
  const credentialId = authData.slice(i, i + credIdLen); i += credIdLen
  const cosePubKeyBytes = authData.slice(i)
  const coseMap = cborDecode(cosePubKeyBytes)
  if (!isMap(coseMap)) throw new Error('COSE_Key: expected map')
  const x = mapGet(coseMap, -2) as Uint8Array | undefined
  const y = mapGet(coseMap, -3) as Uint8Array | undefined
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error('COSE_Key: missing x/y coordinates')
  }

  return {
    credentialId,
    credentialIdBase64Url: base64urlFromBytes(credentialId),
    pubKeyX: bytesToBigInt(x),
    pubKeyY: bytesToBigInt(y),
    aaguid,
    signCount,
    flagAttestedCredentialData: flagAT,
    flagUserPresent: flagUP,
    flagUserVerified: flagUV,
  }
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n
}

function base64urlFromBytes(b: Uint8Array): string {
  let bin = ''
  for (const x of b) bin += String.fromCharCode(x)
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (globalThis as any).Buffer.from(b).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ─── Minimal CBOR decoder (RFC 8949 subset) ───────────────────────────

type CborMap = Map<CborKey, CborValue>
type CborKey = number | bigint | string
type CborValue = number | bigint | string | Uint8Array | CborValue[] | CborMap | boolean | null

function isMap(v: unknown): v is CborMap {
  return v instanceof Map
}

function mapGet(m: CborMap, key: CborKey): CborValue | undefined {
  // Try both number and bigint key forms (CBOR decoder may choose either for negatives/ints).
  if (m.has(key)) return m.get(key)
  if (typeof key === 'number') {
    const bk = BigInt(key)
    if (m.has(bk)) return m.get(bk)
  }
  if (typeof key === 'string') return m.get(key)
  return undefined
}

function cborDecode(bytes: Uint8Array): CborValue {
  const reader = { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos: 0 }
  return decodeOne(reader)

  function decodeOne(r: { view: DataView; pos: number }): CborValue {
    const first = r.view.getUint8(r.pos++); const major = first >> 5; const minor = first & 0x1f
    const len = readLength(r, minor)
    switch (major) {
      case 0: return len as number | bigint                              // unsigned int
      case 1: return typeof len === 'bigint' ? -(len + 1n) : -(len as number) - 1  // negative int
      case 2: { const b = new Uint8Array(r.view.buffer, r.view.byteOffset + r.pos, Number(len)); r.pos += Number(len); return b.slice() }
      case 3: { const b = new Uint8Array(r.view.buffer, r.view.byteOffset + r.pos, Number(len)); r.pos += Number(len); return new TextDecoder().decode(b) }
      case 4: { const out: CborValue[] = []; for (let i = 0n; i < BigInt(len); i++) out.push(decodeOne(r)); return out }
      case 5: {
        const m: CborMap = new Map()
        for (let i = 0n; i < BigInt(len); i++) {
          const k = decodeOne(r) as CborKey
          const v = decodeOne(r)
          m.set(k, v)
        }
        return m
      }
      case 7:
        if (minor === 20) return false
        if (minor === 21) return true
        if (minor === 22) return null
        throw new Error('CBOR: unsupported simple/float value')
      default:
        throw new Error(`CBOR: unsupported major type ${major}`)
    }
  }

  function readLength(r: { view: DataView; pos: number }, minor: number): number | bigint {
    if (minor < 24) return minor
    if (minor === 24) { const v = r.view.getUint8(r.pos); r.pos += 1; return v }
    if (minor === 25) { const v = r.view.getUint16(r.pos, false); r.pos += 2; return v }
    if (minor === 26) { const v = r.view.getUint32(r.pos, false); r.pos += 4; return v }
    if (minor === 27) {
      const hi = r.view.getUint32(r.pos, false); const lo = r.view.getUint32(r.pos + 4, false); r.pos += 8
      return (BigInt(hi) << 32n) | BigInt(lo)
    }
    throw new Error('CBOR: indefinite-length / reserved length not supported')
  }
}
