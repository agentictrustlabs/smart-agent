#!/usr/bin/env tsx
/**
 * kms-signer-address — derive the EVM address from a KMS asymmetric
 * `ECC_SECG_P256K1` signing key.
 *
 * Usage:
 *   pnpm exec tsx scripts/kms-signer-address.ts \
 *     --region us-east-1 \
 *     --key-id arn:aws:kms:us-east-1:111122223333:key/<UUID>
 *
 *   pnpm exec tsx scripts/kms-signer-address.ts \
 *     --region us-east-1 \
 *     --profile smart-agent-prod \
 *     --key-id arn:aws:kms:us-east-1:111122223333:key/<UUID>
 *
 *   pnpm exec tsx scripts/kms-signer-address.ts --help
 *
 * This is operator tooling for the K4 PR-3 setup flow
 * (`docs/operations/kms-signer-setup.md` Step 4). It calls
 * `kms:GetPublicKey` on the specified KMS asymmetric key, unwraps the
 * returned DER `SubjectPublicKeyInfo` to extract the SEC1 uncompressed
 * point, drops the `0x04` prefix, hashes the 64 remaining bytes with
 * keccak-256, takes the last 20 bytes — and that is the on-chain EVM
 * address every smart account must list as an owner.
 *
 * Required AWS IAM permissions on the caller:
 *   - kms:GetPublicKey on the key ARN
 *   - kms:DescribeKey on the key ARN (used to assert KeySpec)
 *
 * Bypass-guard note: this script imports `@aws-sdk/client-kms` directly,
 * which would be a violation in `apps/web/src` or
 * `apps/a2a-agent/src/routes`. `scripts/` is intentionally NOT in the
 * bypass guard's scope (`scripts/check-no-bypass.sh` only walks
 * `apps/web/src` for MCP-URL bypasses and `apps/a2a-agent/src/routes`
 * for KMS-SDK bypasses). Operator tooling is a documented exception:
 * the substrate-allowlist invariant (`docs/architecture/01-web-a2a-mcp-flows.md`)
 * scopes to runtime call paths, not workstation utilities.
 *
 * TODO(K4 PR-2): once `aws-kms-signer.ts` and the `extractSec1FromSpki`
 * export from `@smart-agent/sdk/key-custody` land, replace the inline
 * SPKI parser below with the canonical helper. The current inline copy
 * is a verbatim of `packages/sdk/src/key-custody/der-utils.ts` and
 * exists so PR-3 can land in parallel with PR-2 without a dependency
 * order.
 */
import { KMSClient, GetPublicKeyCommand, DescribeKeyCommand } from '@aws-sdk/client-kms'
import { keccak_256 } from '@noble/hashes/sha3'

// ─── CLI plumbing ────────────────────────────────────────────────────

interface ParsedArgs {
  region?: string
  keyId?: string
  profile?: string
  help: boolean
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') {
      out.help = true
      continue
    }
    if (a === '--region') {
      out.region = argv[++i]
      continue
    }
    if (a === '--key-id') {
      out.keyId = argv[++i]
      continue
    }
    if (a === '--profile') {
      out.profile = argv[++i]
      continue
    }
    if (a.startsWith('--region=')) {
      out.region = a.slice('--region='.length)
      continue
    }
    if (a.startsWith('--key-id=')) {
      out.keyId = a.slice('--key-id='.length)
      continue
    }
    if (a.startsWith('--profile=')) {
      out.profile = a.slice('--profile='.length)
      continue
    }
    throw new Error(`unknown argument: ${a}`)
  }
  return out
}

const USAGE = `\
kms-signer-address — derive the EVM address from a KMS asymmetric ECC_SECG_P256K1 key

Usage:
  pnpm exec tsx scripts/kms-signer-address.ts --region <REGION> --key-id <KEY_ARN_OR_ID>
  pnpm exec tsx scripts/kms-signer-address.ts --region <REGION> --profile <AWS_PROFILE> --key-id <KEY_ARN_OR_ID>
  pnpm exec tsx scripts/kms-signer-address.ts --help

Arguments:
  --region <REGION>     AWS region where the KMS key lives (e.g. us-east-1). Required.
  --key-id <ID>         KMS key ARN, bare UUID, or alias. Required.
  --profile <PROFILE>   Optional AWS shared-credentials profile name. When omitted,
                        the default AWS SDK credential chain is used (env vars,
                        ~/.aws/credentials default profile, SSO, IMDS, ...).
  -h, --help            Print this message and exit 0.

Required IAM permissions on the caller:
  kms:GetPublicKey, kms:DescribeKey  (both on the specified key ARN).

Output (success):
  [kms-signer-address] keyId   : arn:aws:kms:us-east-1:111122223333:key/<UUID>
  [kms-signer-address] keySpec : ECC_SECG_P256K1
  [kms-signer-address] address : 0x<40-hex-chars>

Exit codes:
  0 on success.
  1 on any error (bad args, AWS call failure, wrong key spec, malformed SPKI).
`

// ─── ASN.1 DER walk (inlined from packages/sdk/src/key-custody/der-utils.ts) ───
// TODO(K4 PR-2): swap for `import { extractSec1FromSpki } from '@smart-agent/sdk/key-custody'`
// once PR-2 exports it from the barrel.

function readDerLen(buf: Uint8Array, off: number): { value: number; next: number } {
  if (off >= buf.length) throw new Error('der: unexpected end of buffer when reading length')
  const b = buf[off]!
  if (b < 0x80) return { value: b, next: off + 1 }
  const n = b & 0x7f
  if (n === 0 || n > 4) throw new Error('der: unsupported length form')
  if (off + 1 + n > buf.length) throw new Error('der: length bytes exceed buffer')
  let v = 0
  for (let i = 0; i < n; i++) v = (v << 8) | buf[off + 1 + i]!
  return { value: v, next: off + 1 + n }
}

/**
 * Unwrap a DER `SubjectPublicKeyInfo` to the 65-byte SEC1 uncompressed
 * point (`0x04 || X || Y`). Mirrors `extractSec1FromSpki` in the SDK.
 */
function extractSec1FromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length < 2 || spki[0] !== 0x30) throw new Error('spki: expected SEQUENCE')
  let off = 1
  const seqLen = readDerLen(spki, off)
  off = seqLen.next
  if (seqLen.value !== spki.length - off) throw new Error('spki: outer length mismatch')

  // AlgorithmIdentifier — another SEQUENCE; skip its content.
  if (off >= spki.length || spki[off] !== 0x30) {
    throw new Error('spki: expected AlgorithmIdentifier SEQUENCE')
  }
  off++
  const algLen = readDerLen(spki, off)
  off = algLen.next + algLen.value
  if (off > spki.length) throw new Error('spki: alg block overruns buffer')

  // BIT STRING containing the SEC1 point.
  if (off >= spki.length || spki[off] !== 0x03) throw new Error('spki: expected BIT STRING')
  off++
  const bitLen = readDerLen(spki, off)
  off = bitLen.next
  if (off + bitLen.value > spki.length) throw new Error('spki: bit string overruns buffer')
  if (spki[off] !== 0x00) throw new Error('spki: non-zero unused-bits byte')
  off++
  const point = spki.slice(off, off + bitLen.value - 1)
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(
      `spki: expected 65-byte SEC1 uncompressed point with 0x04 prefix (got ${point.length} bytes, first=${point[0]?.toString(16)})`,
    )
  }
  return point
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    s += (b < 16 ? '0' : '') + b.toString(16)
  }
  return s
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`[kms-signer-address] ${(err as Error).message}\n\n${USAGE}`)
    return 1
  }

  if (args.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (!args.region) {
    process.stderr.write(`[kms-signer-address] --region is required\n\n${USAGE}`)
    return 1
  }
  if (!args.keyId) {
    process.stderr.write(`[kms-signer-address] --key-id is required\n\n${USAGE}`)
    return 1
  }

  // When --profile is provided we set AWS_PROFILE in the environment so the
  // default credential chain (which the SDK uses when `credentials` is not
  // passed) picks it up. Avoids depending on @aws-sdk/credential-providers
  // (a separate package not currently in our deps).
  if (args.profile) {
    process.env.AWS_PROFILE = args.profile
  }

  const client = new KMSClient({ region: args.region })

  // 1. DescribeKey — assert KeySpec = ECC_SECG_P256K1 before trusting GetPublicKey.
  let keySpec: string | undefined
  try {
    const desc = await client.send(new DescribeKeyCommand({ KeyId: args.keyId }))
    keySpec = desc.KeyMetadata?.KeySpec
    const keyUsage = desc.KeyMetadata?.KeyUsage
    if (keySpec !== 'ECC_SECG_P256K1') {
      process.stderr.write(
        `[kms-signer-address] ERROR: key has KeySpec=${keySpec ?? '(unknown)'}; expected ECC_SECG_P256K1.\n` +
          `This is the only valid spec for an EVM secp256k1 signer.\n`,
      )
      return 1
    }
    if (keyUsage !== 'SIGN_VERIFY') {
      process.stderr.write(
        `[kms-signer-address] ERROR: key has KeyUsage=${keyUsage ?? '(unknown)'}; expected SIGN_VERIFY.\n`,
      )
      return 1
    }
  } catch (err) {
    process.stderr.write(
      `[kms-signer-address] DescribeKey failed: ${(err as Error).message}\n` +
        `Hint: required IAM permission is kms:DescribeKey on the key ARN.\n`,
    )
    return 1
  }

  // 2. GetPublicKey — fetch DER SPKI and decode.
  let spki: Uint8Array
  try {
    const out = await client.send(new GetPublicKeyCommand({ KeyId: args.keyId }))
    if (!out.PublicKey) throw new Error('GetPublicKey returned no key material')
    spki = out.PublicKey
  } catch (err) {
    process.stderr.write(
      `[kms-signer-address] GetPublicKey failed: ${(err as Error).message}\n` +
        `Hint: required IAM permission is kms:GetPublicKey on the key ARN.\n`,
    )
    return 1
  }

  // 3. Derive the EVM address.
  let address: string
  try {
    const sec1 = extractSec1FromSpki(spki) // 65 bytes: 0x04 || X || Y
    const rawXY = sec1.slice(1) // 64 bytes
    const addrBytes = keccak_256(rawXY).slice(-20)
    address = '0x' + bytesToHex(addrBytes)
  } catch (err) {
    process.stderr.write(
      `[kms-signer-address] failed to decode public key: ${(err as Error).message}\n`,
    )
    return 1
  }

  // 4. Emit the canonical operator-facing output.
  process.stdout.write(`[kms-signer-address] keyId   : ${args.keyId}\n`)
  process.stdout.write(`[kms-signer-address] keySpec : ${keySpec}\n`)
  process.stdout.write(`[kms-signer-address] address : ${address}\n`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[kms-signer-address] unexpected error: ${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
