#!/usr/bin/env tsx
/**
 * diagnose-gcp-kms — deploy-time smoke test for the GCP Cloud KMS sibling
 * backend (G-PR-6, per `output/GCP-KMS-IMPLEMENTATION-PLAN.md` § G11).
 *
 * What it does:
 *   1. Reads every `GCP_*` env var and reports presence + format (NEVER
 *      prints values — env paths are non-secret identifiers but the
 *      script treats them as sensitive so a stdout capture in a CI log
 *      can't leak resource shapes).
 *   2. Calls `createGcpAuthClient(env)` and reports any auth-env error.
 *   3. For each active key class (session / master / tool-executors / MAC),
 *      makes a no-op KMS call (`getPublicKey` for asymmetric,
 *      `getCryptoKey` for symmetric/MAC) to verify IAM permissions.
 *   4. Reports per-key status: OK / missing env / IAM denied / key not found.
 *   5. Returns exit code 0 if every active key class is OK; non-zero otherwise.
 *
 * Usage:
 *   pnpm tsx scripts/diagnose-gcp-kms.ts
 *   pnpm tsx scripts/diagnose-gcp-kms.ts --help
 *
 * This is a ONE-SHOT deploy-time smoke test, not a runtime gate. The
 * runtime gate is `assertGcpEnvComplete(env)` in
 * `apps/a2a-agent/src/lib/policy-startup.ts`, which refuses to start the
 * agent if any required identifier is missing.
 *
 * Bypass-guard note: this script imports `@google-cloud/kms` directly,
 * which would be a violation in any apps/* or packages/sdk/* file outside
 * `packages/sdk/src/key-custody/`. `scripts/` is intentionally NOT in the
 * bypass guard's scope — operator workstation utilities are an exception
 * to the substrate-allowlist rule. See `scripts/check-no-bypass.sh` and
 * `docs/operator/gcp-kms-provisioning.md` for the canonical rules.
 */
import { KeyManagementServiceClient } from '@google-cloud/kms'
import {
  createGcpAuthClient,
  GCP_AUTH_ENV_KEYS,
  MAC_KEY_IDS,
  TOOL_EXECUTOR_IDS,
  envKeyForMacKeyId,
  toolEnvKeyName,
  type MacKeyId,
  type ToolExecutorId,
} from '@smart-agent/sdk/key-custody'

// ─── CLI plumbing ────────────────────────────────────────────────────

interface ParsedArgs {
  help: boolean
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { help: false }
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      out.help = true
      continue
    }
    throw new Error(`unknown argument: ${a}`)
  }
  return out
}

const USAGE = `\
diagnose-gcp-kms — deploy-time smoke test for the GCP Cloud KMS backend

Usage:
  pnpm tsx scripts/diagnose-gcp-kms.ts
  pnpm tsx scripts/diagnose-gcp-kms.ts --help

Required env (read from the current process env, typically loaded from
the same .env / Vercel-pull source the agent boots against):

  Auth identifiers (5, required if any GCP key class is in use):
    GCP_PROJECT_ID
    GCP_PROJECT_NUMBER
    GCP_WORKLOAD_IDENTITY_POOL_ID
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
    GCP_SERVICE_ACCOUNT_EMAIL

  Session envelope (G2):
    GCP_KMS_SESSION_KEK
    GCP_KMS_SESSION_KEK_VERSION   (optional — pin to a specific version)

  Master EOA signer (G3):
    GCP_KMS_MASTER_SIGNER_VERSION

  Tool executor signers (G4) — one per TOOL_EXECUTOR_IDS:
    GCP_KMS_TOOL_EXECUTOR_<TOOL>_VERSION

  Inter-service MAC (G5) — one per MAC_KEY_IDS:
    GCP_KMS_MAC_<EDGE>_VERSION

What it does:
  1. Reports presence + format of every GCP_* env var (without printing values).
  2. Calls createGcpAuthClient(env) and surfaces auth-env errors.
  3. Per active key class, makes a no-op KMS call to verify IAM permissions
     (getPublicKey for asymmetric, getCryptoKey for symmetric/MAC).
  4. Prints per-key status: OK / missing env / IAM denied / key not found.

Exit codes:
  0  every key class with env set is OK.
  1  one or more key classes reported missing env / IAM denied / key not found,
     or auth client construction failed, or any unexpected error.
  2  bad CLI arguments.

See docs/operator/gcp-kms-provisioning.md for the provisioning runbook.
`

// ─── Status reporting types ──────────────────────────────────────────

type KeyStatus =
  | { kind: 'ok'; label: string; envVar: string }
  | { kind: 'missing-env'; label: string; envVar: string }
  | { kind: 'iam-denied'; label: string; envVar: string; detail: string }
  | { kind: 'not-found'; label: string; envVar: string; detail: string }
  | { kind: 'other-error'; label: string; envVar: string; detail: string }

function statusGlyph(s: KeyStatus): string {
  switch (s.kind) {
    case 'ok':
      return 'OK'
    case 'missing-env':
      return 'MISSING ENV'
    case 'iam-denied':
      return 'IAM DENIED'
    case 'not-found':
      return 'NOT FOUND'
    case 'other-error':
      return 'ERROR'
  }
}

function classifyKmsError(err: unknown): {
  kind: 'iam-denied' | 'not-found' | 'other-error'
  detail: string
} {
  const msg = err instanceof Error ? err.message : String(err)
  // Google client errors carry a numeric code on the error object.
  // 7 = PERMISSION_DENIED, 5 = NOT_FOUND.
  const code = (err as { code?: number | string }).code
  if (code === 7 || /PERMISSION_DENIED|permission denied|forbidden/i.test(msg)) {
    return { kind: 'iam-denied', detail: msg.slice(0, 200) }
  }
  if (code === 5 || /NOT_FOUND|not found/i.test(msg)) {
    return { kind: 'not-found', detail: msg.slice(0, 200) }
  }
  return { kind: 'other-error', detail: msg.slice(0, 200) }
}

// ─── Env classification ──────────────────────────────────────────────

interface EnvSnapshot {
  auth: Record<string, string | undefined>
  sessionKek?: string
  sessionKekVersion?: string
  masterSignerVersion?: string
  toolExecutorVersions: Record<ToolExecutorId, string | undefined>
  macVersions: Record<MacKeyId, string | undefined>
}

function readEnv(): EnvSnapshot {
  const env = process.env
  const auth: Record<string, string | undefined> = {}
  for (const key of GCP_AUTH_ENV_KEYS) {
    auth[key] = env[key]
  }

  const toolExecutorVersions = {} as Record<ToolExecutorId, string | undefined>
  for (const id of TOOL_EXECUTOR_IDS) {
    toolExecutorVersions[id] = env[toolEnvKeyName(id, 'gcp-kms')]
  }

  const macVersions = {} as Record<MacKeyId, string | undefined>
  for (const id of MAC_KEY_IDS) {
    macVersions[id] = env[envKeyForMacKeyId(id).gcpKms]
  }

  return {
    auth,
    sessionKek: env.GCP_KMS_SESSION_KEK,
    sessionKekVersion: env.GCP_KMS_SESSION_KEK_VERSION,
    masterSignerVersion: env.GCP_KMS_MASTER_SIGNER_VERSION,
    toolExecutorVersions,
    macVersions,
  }
}

function formatFormatHint(value: string | undefined): string {
  if (value === undefined) return 'unset'
  if (value === '') return 'empty'
  // Categorise resource path shape without printing the value.
  if (/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/\d+$/.test(value)) {
    return 'set (cryptoKeyVersions resource path)'
  }
  if (/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(value)) {
    return 'set (cryptoKeys resource path)'
  }
  if (value.includes('@') && value.endsWith('.gserviceaccount.com')) {
    return 'set (service account email)'
  }
  if (/^\d+$/.test(value)) {
    return 'set (numeric)'
  }
  return 'set (free-form, length=' + value.length + ')'
}

// ─── KMS smoke-test helpers ──────────────────────────────────────────

/**
 * Strip the `/cryptoKeyVersions/<n>` suffix from a resource path so we
 * can call `getCryptoKey` on the parent. Returns null if the input is
 * already a parent path (or unrecognised).
 */
function cryptoKeyParent(path: string): string | null {
  const m = /^(projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+)\/cryptoKeyVersions\/\d+$/.exec(
    path,
  )
  if (m) return m[1]!
  if (/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(path)) {
    return path
  }
  return null
}

async function probeAsymmetricSigner(
  client: KeyManagementServiceClient,
  versionPath: string,
  label: string,
  envVar: string,
): Promise<KeyStatus> {
  try {
    // getPublicKey is a no-op read; requires roles/cloudkms.publicKeyViewer
    // OR roles/cloudkms.signer (signer subsumes the public-key read for
    // its own key versions).
    const [resp] = await client.getPublicKey({ name: versionPath })
    if (!resp || (!resp.pem && !resp.publicKey)) {
      return {
        kind: 'other-error',
        label,
        envVar,
        detail: 'getPublicKey returned no key material',
      }
    }
    return { kind: 'ok', label, envVar }
  } catch (err) {
    const c = classifyKmsError(err)
    return { ...c, label, envVar }
  }
}

async function probeCryptoKey(
  client: KeyManagementServiceClient,
  resourcePath: string,
  label: string,
  envVar: string,
): Promise<KeyStatus> {
  const parent = cryptoKeyParent(resourcePath)
  if (!parent) {
    return {
      kind: 'other-error',
      label,
      envVar,
      detail: 'resource path does not match expected projects/.../cryptoKeys/<...> shape',
    }
  }
  try {
    // getCryptoKey verifies IAM on the key (requires
    // roles/cloudkms.viewer OR any role that includes
    // cloudkms.cryptoKeys.get — the encrypter/decrypter and signer roles
    // both include it).
    await client.getCryptoKey({ name: parent })
    return { kind: 'ok', label, envVar }
  } catch (err) {
    const c = classifyKmsError(err)
    return { ...c, label, envVar }
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`[diagnose-gcp-kms] ${(err as Error).message}\n\n${USAGE}`)
    return 2
  }

  if (args.help) {
    process.stdout.write(USAGE)
    return 0
  }

  process.stdout.write('[diagnose-gcp-kms] starting GCP KMS deploy-time smoke test\n')

  const env = readEnv()

  // ─── 1. Env presence + format report ─────────────────────────────
  process.stdout.write('\n--- Env vars (presence + shape, values NOT printed) ---\n')
  for (const key of GCP_AUTH_ENV_KEYS) {
    process.stdout.write(`  ${key.padEnd(48)} ${formatFormatHint(env.auth[key])}\n`)
  }
  process.stdout.write(`  ${'GCP_KMS_SESSION_KEK'.padEnd(48)} ${formatFormatHint(env.sessionKek)}\n`)
  process.stdout.write(`  ${'GCP_KMS_SESSION_KEK_VERSION'.padEnd(48)} ${formatFormatHint(env.sessionKekVersion)}\n`)
  process.stdout.write(
    `  ${'GCP_KMS_MASTER_SIGNER_VERSION'.padEnd(48)} ${formatFormatHint(env.masterSignerVersion)}\n`,
  )
  for (const id of TOOL_EXECUTOR_IDS) {
    const name = toolEnvKeyName(id, 'gcp-kms')
    process.stdout.write(`  ${name.padEnd(48)} ${formatFormatHint(env.toolExecutorVersions[id])}\n`)
  }
  for (const id of MAC_KEY_IDS) {
    const name = envKeyForMacKeyId(id).gcpKms
    process.stdout.write(`  ${name.padEnd(48)} ${formatFormatHint(env.macVersions[id])}\n`)
  }

  // ─── 2. Auth client construction ────────────────────────────────
  process.stdout.write('\n--- Auth client (Workload Identity Federation) ---\n')
  try {
    createGcpAuthClient({
      GCP_PROJECT_ID: env.auth.GCP_PROJECT_ID ?? '',
      GCP_PROJECT_NUMBER: env.auth.GCP_PROJECT_NUMBER ?? '',
      GCP_WORKLOAD_IDENTITY_POOL_ID: env.auth.GCP_WORKLOAD_IDENTITY_POOL_ID ?? '',
      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
        env.auth.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID ?? '',
      GCP_SERVICE_ACCOUNT_EMAIL: env.auth.GCP_SERVICE_ACCOUNT_EMAIL ?? '',
    })
    process.stdout.write('  createGcpAuthClient(env) ............. OK\n')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`  createGcpAuthClient(env) ............. FAIL — ${msg}\n`)
    process.stdout.write(
      '\n[diagnose-gcp-kms] auth client construction failed; ' +
        'fix the missing identifier(s) above before continuing.\n',
    )
    return 1
  }

  // ─── 3. Per-key probes ──────────────────────────────────────────
  // We use one KMS client; it picks up GOOGLE-style auth from the
  // ambient environment. For workstation use, operators authenticate
  // via `gcloud auth application-default login` (which is the standard
  // GCP CLI pattern for one-off scripts). The runtime path uses
  // Workload Identity Federation per `createGcpAuthClient`, which is
  // exercised by the agent at boot — separate concerns.
  const client = new KeyManagementServiceClient()
  const statuses: KeyStatus[] = []

  // 3a. Session KEK (symmetric)
  process.stdout.write('\n--- Session envelope KEK (G2) ---\n')
  if (!env.sessionKek) {
    statuses.push({
      kind: 'missing-env',
      label: 'session-kek',
      envVar: 'GCP_KMS_SESSION_KEK',
    })
  } else {
    const s = await probeCryptoKey(client, env.sessionKek, 'session-kek', 'GCP_KMS_SESSION_KEK')
    statuses.push(s)
  }
  process.stdout.write(`  GCP_KMS_SESSION_KEK ......... ${statusGlyph(statuses[statuses.length - 1]!)}\n`)

  // 3b. Master EOA signer (asymmetric)
  process.stdout.write('\n--- Master EOA signer (G3) ---\n')
  if (!env.masterSignerVersion) {
    statuses.push({
      kind: 'missing-env',
      label: 'master-eoa-signer',
      envVar: 'GCP_KMS_MASTER_SIGNER_VERSION',
    })
  } else {
    const s = await probeAsymmetricSigner(
      client,
      env.masterSignerVersion,
      'master-eoa-signer',
      'GCP_KMS_MASTER_SIGNER_VERSION',
    )
    statuses.push(s)
  }
  process.stdout.write(
    `  GCP_KMS_MASTER_SIGNER_VERSION ......... ${statusGlyph(statuses[statuses.length - 1]!)}\n`,
  )

  // 3c. Tool executor signers (asymmetric, one per TOOL_EXECUTOR_IDS)
  process.stdout.write('\n--- Tool executor signers (G4) ---\n')
  for (const id of TOOL_EXECUTOR_IDS) {
    const envName = toolEnvKeyName(id, 'gcp-kms')
    const version = env.toolExecutorVersions[id]
    let s: KeyStatus
    if (!version) {
      s = { kind: 'missing-env', label: `tool-executor:${id}`, envVar: envName }
    } else {
      s = await probeAsymmetricSigner(client, version, `tool-executor:${id}`, envName)
    }
    statuses.push(s)
    process.stdout.write(`  ${envName.padEnd(52)} ${statusGlyph(s)}\n`)
  }

  // 3d. MAC keys (HMAC; symmetric-style getCryptoKey suffices for the IAM smoke)
  process.stdout.write('\n--- Inter-service MAC keys (G5) ---\n')
  for (const id of MAC_KEY_IDS) {
    const envName = envKeyForMacKeyId(id).gcpKms
    const version = env.macVersions[id]
    let s: KeyStatus
    if (!version) {
      s = { kind: 'missing-env', label: `mac:${id}`, envVar: envName }
    } else {
      s = await probeCryptoKey(client, version, `mac:${id}`, envName)
    }
    statuses.push(s)
    process.stdout.write(`  ${envName.padEnd(52)} ${statusGlyph(s)}\n`)
  }

  // ─── 4. Summary + exit code ─────────────────────────────────────
  process.stdout.write('\n--- Summary ---\n')
  const failures = statuses.filter((s) => s.kind !== 'ok')
  if (failures.length === 0) {
    process.stdout.write(
      `  ${statuses.length} key class(es) probed; ALL OK. The deploy is trusted to boot.\n`,
    )
    process.stdout.write(
      '  Note: runtime gate `assertGcpEnvComplete` runs again at agent start as a defense-in-depth check.\n',
    )
    return 0
  }
  process.stdout.write(`  ${failures.length} of ${statuses.length} probe(s) failed:\n`)
  for (const f of failures) {
    if (f.kind === 'missing-env') {
      process.stdout.write(`    [${statusGlyph(f)}] ${f.label.padEnd(28)} env=${f.envVar}\n`)
    } else {
      const detail = 'detail' in f ? ` — ${f.detail}` : ''
      process.stdout.write(`    [${statusGlyph(f)}] ${f.label.padEnd(28)} env=${f.envVar}${detail}\n`)
    }
  }
  process.stdout.write(
    '\n  Fix the failures above and re-run. See docs/operator/gcp-kms-provisioning.md.\n',
  )
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[diagnose-gcp-kms] unexpected error: ${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
