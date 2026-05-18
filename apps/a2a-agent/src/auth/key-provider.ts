/**
 * Selector for the active `A2AKeyProvider` (KMS migration K0+K1 + K2 + G-PR-1).
 *
 * This is the ONLY module in a2a-agent that instantiates a provider. Every
 * other call site (encryption helper, future signer wrapper, future MAC
 * wrapper) imports the singleton from `./encryption.ts` (which calls into
 * here once at module load).
 *
 * Backend selection via `A2A_KMS_BACKEND` (default `'local-aes'`):
 *   - 'local-aes'     → `createLocalAesProvider` from `@smart-agent/sdk/key-custody`.
 *                       Refused at startup when `NODE_ENV === 'production'`.
 *   - 'aws-kms'       → `createAwsKmsProvider` from `@smart-agent/sdk/key-custody`.
 *                       K2 v1 prod implementation target (KMS-IMPLEMENTATION-PLAN
 *                       §3.2a). Credentials come from
 *                       `@vercel/oidc-aws-credentials-provider` at request scope.
 *   - 'gcp-kms'       → GCP Cloud KMS via Workload Identity Federation
 *                       (GCP-KMS-IMPLEMENTATION-PLAN.md § G2/G3/G4/G5).
 *                       G-PR-1 only wires the auth primitive +
 *                       identifier-env validation; provider/signer/MAC
 *                       implementations land in G-PR-2..G-PR-5.
 *                       The selector branch validates env first, then
 *                       constructs the auth client (so auth-env errors
 *                       surface before "not yet implemented"), then
 *                       throws the staged marker error.
 *   - anything else   → throws "unknown A2A_KMS_BACKEND" so an env typo
 *                       fails closed at startup instead of silently falling
 *                       back to a default.
 *
 * The production guard for 'local-aes' is also reflected in the AWS IAM
 * template (KMS-IMPLEMENTATION-PLAN.md §8.1), but enforcing it at process
 * boot is the cheapest pre-flight: a misconfigured deployment refuses to
 * come up rather than ever serving requests under the dev shim.
 *
 * The 'vault-transit' deferred-sibling case was removed in G-PR-1
 * (orchestrator decision per GCP plan § G6: AWS + GCP only — no dead-code
 * stubs). Setting A2A_KMS_BACKEND='vault-transit' now falls into the
 * `default` branch and throws "unknown A2A_KMS_BACKEND".
 */
import type {
  A2AKeyProvider,
  AwsKmsSignerAuditEvent,
  GcpAuthEnv,
  KmsAccountBackend,
  LocalSecp256k1SignerAuditEvent,
  ToolExecutorId,
  ToolExecutorSignerBackend,
} from '@smart-agent/sdk/key-custody'
import {
  createAwsKmsProvider,
  createAwsKmsSigner,
  createGcpAuthClient,
  createLocalAesProvider,
  createLocalSecp256k1Signer,
  createToolExecutorSigner,
  GCP_AUTH_ENV_KEYS,
  toolEnvKeyName,
} from '@smart-agent/sdk/key-custody'

/**
 * Sprint 3 S3.2 — audit callback shape for the master + tool-executor
 * signers. The two SDK signer audit-event types have the SAME field
 * layout (intentional — dev/prod parity), so the union here covers both
 * paths uniformly. The caller (a2a-signer.ts) writes one
 * `execution_audit` row per event.
 */
export type SignerAuditEvent =
  | AwsKmsSignerAuditEvent
  | LocalSecp256k1SignerAuditEvent

export type SignerAuditFn = (event: SignerAuditEvent) => Promise<void> | void

export interface KeyProviderEnv {
  A2A_KMS_BACKEND?: string
  NODE_ENV?: string
  A2A_SESSION_SECRET?: string
  // K2 v1 — AWS KMS. Required when A2A_KMS_BACKEND='aws-kms'.
  AWS_REGION?: string
  AWS_ROLE_ARN?: string
  AWS_KMS_KEY_ID?: string
  // K4 PR-1 — local-secp256k1 master-EOA signer (dev-only fallback).
  A2A_MASTER_PRIVATE_KEY?: string
  // K4 PR-2 — AWS KMS asymmetric `ECC_SECG_P256K1` signer key id.
  // SEPARATE from `AWS_KMS_KEY_ID` (which is the K2 symmetric envelope key):
  // different KMS key spec, different IAM permission set (`kms:Sign` +
  // `kms:GetPublicKey` vs `kms:GenerateDataKey` + `kms:Decrypt`).
  AWS_KMS_SIGNER_KEY_ID?: string
  // GCP-KMS G-PR-1 — Workload Identity Federation identifiers. Required
  // when A2A_KMS_BACKEND='gcp-kms'. NONE are secrets — the operator runbook
  // (`docs/operator/gcp-kms-provisioning.md`, to be added in a later PR) lists
  // them as project identifiers / WIF coordinates.
  GCP_PROJECT_ID?: string
  GCP_PROJECT_NUMBER?: string
  GCP_WORKLOAD_IDENTITY_POOL_ID?: string
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?: string
  GCP_SERVICE_ACCOUNT_EMAIL?: string
  // GCP-KMS G-PR-2..G-PR-5 — per-key-class GCP KMS resource names. Each is a
  // full GCP resource path (e.g. `projects/.../cryptoKeys/...`). Validated at
  // the matching factory.
  GCP_KMS_SESSION_KEK?: string
  GCP_KMS_MASTER_SIGNER_VERSION?: string
  // K5 — per-tool executor signer env vars. Read by name via
  // `toolEnvKeyName(toolId, backend)`. Both forms are accepted:
  //   - 'local-aes' path: TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY
  //   - 'aws-kms'   path: AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID
  //   - 'gcp-kms'   path: GCP_KMS_TOOL_EXECUTOR_<TOOL_ID>_VERSION
  // The signature is indexed (string) because the env var names are
  // synthesized from the tool id at call site rather than enumerated
  // here; this keeps the canonical list in `TOOL_EXECUTOR_IDS` rather
  // than duplicated across types.
  [key: string]: string | undefined
}

// ─── GCP-KMS G-PR-1 — shared production-guard + env-validation helpers ───
//
// These are call-site shared by buildKeyProvider, buildSignerBackend,
// buildToolExecutorBackend, and (via re-import) the MAC factory in
// `mac-provider.ts`. Keeping them in one place means the four factories
// can't drift on the "what counts as a forbidden static key in prod"
// invariant.

/**
 * Env vars that MUST NOT be set when `NODE_ENV='production'` AND
 * `A2A_KMS_BACKEND='gcp-kms'`. Any of these present in production refuses
 * boot — the GCP backend uses Workload Identity Federation; static cloud
 * credentials and per-process static signing/MAC keys are forensics
 * liabilities with no operational value.
 *
 * Pattern-form variables (TOOL_EXECUTOR_*_PRIVATE_KEY,
 * A2A_INTERSERVICE_HMAC_KEY_*) are matched via `assertNoForbiddenStaticKeys`
 * below.
 *
 * The operator runbook at `docs/operator/gcp-kms-provisioning.md`
 * (forthcoming — G10 in the GCP plan) is the canonical reference.
 */
const GCP_FORBIDDEN_STATIC_ENV_KEYS = [
  // GCP-side static credentials (Workload Identity Federation must be used).
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GCP_SERVICE_ACCOUNT_KEY_JSON',
  // Legacy per-process secrets.
  'A2A_SESSION_SECRET',
  'A2A_MASTER_EOA_PRIVATE_KEY',
  'WEB_TO_A2A_HMAC_KEY',
] as const

/** Prefix patterns: any env var starting with one of these is forbidden. */
const GCP_FORBIDDEN_STATIC_ENV_PREFIXES = [
  'TOOL_EXECUTOR_', // any TOOL_EXECUTOR_*_PRIVATE_KEY
  'A2A_INTERSERVICE_HMAC_KEY_', // any per-MCP HMAC key
] as const

/**
 * Refuse boot when `NODE_ENV='production'` AND `A2A_KMS_BACKEND='gcp-kms'`
 * AND any forbidden static-key env var is set. The error message lists
 * the offending variable(s) by name so the operator can search the
 * deployment env.
 *
 * Exported only for test access via re-import (`assertNoForbiddenGcpStaticKeys`).
 *
 * @throws if any forbidden static env var is present.
 */
export function assertNoForbiddenGcpStaticKeys(env: KeyProviderEnv): void {
  const offenders: string[] = []
  for (const key of GCP_FORBIDDEN_STATIC_ENV_KEYS) {
    if (env[key] !== undefined && env[key] !== '') offenders.push(key)
  }
  for (const envKey of Object.keys(env)) {
    if (env[envKey] === undefined || env[envKey] === '') continue
    for (const prefix of GCP_FORBIDDEN_STATIC_ENV_PREFIXES) {
      // Pattern keys: only flag PRIVATE_KEY suffixes for TOOL_EXECUTOR_;
      // the AnyName_HMAC_KEY suffix is the only legitimate completion of
      // A2A_INTERSERVICE_HMAC_KEY_, so any match there is forbidden.
      if (envKey.startsWith(prefix)) {
        if (
          prefix === 'TOOL_EXECUTOR_' &&
          !envKey.endsWith('_PRIVATE_KEY')
        ) {
          continue
        }
        offenders.push(envKey)
        break
      }
    }
  }
  if (offenders.length > 0) {
    const unique = Array.from(new Set(offenders)).sort()
    throw new Error(
      "production guard: A2A_KMS_BACKEND='gcp-kms' with NODE_ENV='production' " +
        `refuses to start — forbidden static-key env var(s) set: ${unique.join(', ')}. ` +
        'GCP backend uses Workload Identity Federation; static credentials must be removed. ' +
        'See docs/operator/gcp-kms-provisioning.md for the operator runbook.',
    )
  }
}

/**
 * Validate the five required GCP auth identifiers + the production-guard
 * invariants, then construct the auth client. Used by every GCP-KMS
 * factory branch so a misconfigured deployment surfaces auth errors
 * before the staged "not yet implemented" marker.
 *
 * The returned client is intentionally unused in G-PR-1 (the factory
 * throws right after); G-PR-2..G-PR-5 will pass it into each provider.
 *
 * @throws if any required GCP_* identifier is missing.
 * @throws (production) if any forbidden static-key env var is set.
 */
function validateGcpEnvAndBuildAuthClient(
  callerLabel: string,
  env: KeyProviderEnv,
): void {
  for (const key of GCP_AUTH_ENV_KEYS) {
    if (!env[key]) {
      throw new Error(
        `${callerLabel}: ${key} is required for 'gcp-kms' backend ` +
          '(GCP-KMS-IMPLEMENTATION-PLAN.md § G1).',
      )
    }
  }
  if (env.NODE_ENV === 'production') {
    assertNoForbiddenGcpStaticKeys(env)
  }
  // Construct the auth client now so auth-env errors fire BEFORE the
  // staged "not yet implemented" marker. Per the plan G-PR-1: identifier
  // validation > auth client construction > staged throw.
  createGcpAuthClient({
    GCP_PROJECT_ID: env.GCP_PROJECT_ID as string,
    GCP_PROJECT_NUMBER: env.GCP_PROJECT_NUMBER as string,
    GCP_WORKLOAD_IDENTITY_POOL_ID: env.GCP_WORKLOAD_IDENTITY_POOL_ID as string,
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
      env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID as string,
    GCP_SERVICE_ACCOUNT_EMAIL: env.GCP_SERVICE_ACCOUNT_EMAIL as string,
  })
}

// Re-export `GcpAuthEnv` so callers needing the shape can import it from
// the factory module rather than walking the SDK barrel.
export type { GcpAuthEnv }

export function buildKeyProvider(env: KeyProviderEnv): A2AKeyProvider {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      "buildKeyProvider: refusing to instantiate 'local-aes' in production. " +
        "Set A2A_KMS_BACKEND to 'aws-kms' (or another KMS-class backend).",
    )
  }

  switch (backend) {
    case 'local-aes': {
      if (!env.A2A_SESSION_SECRET) {
        throw new Error("buildKeyProvider: A2A_SESSION_SECRET is required for 'local-aes' backend")
      }
      return createLocalAesProvider({ A2A_SESSION_SECRET: env.A2A_SESSION_SECRET })
    }
    case 'aws-kms': {
      if (!env.AWS_REGION) {
        throw new Error("buildKeyProvider: AWS_REGION is required for 'aws-kms' backend")
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error("buildKeyProvider: AWS_ROLE_ARN is required for 'aws-kms' backend")
      }
      if (!env.AWS_KMS_KEY_ID) {
        throw new Error("buildKeyProvider: AWS_KMS_KEY_ID is required for 'aws-kms' backend")
      }
      return createAwsKmsProvider({
        AWS_REGION: env.AWS_REGION,
        AWS_ROLE_ARN: env.AWS_ROLE_ARN,
        AWS_KMS_KEY_ID: env.AWS_KMS_KEY_ID,
      })
    }
    case 'gcp-kms': {
      // GCP-KMS G-PR-1 stub. Validate identifier env + production
      // invariants, then construct the auth client (so an auth-config
      // error surfaces FIRST), then throw the staged marker. The session
      // KEK identifier (`GCP_KMS_SESSION_KEK`) is the buildKeyProvider-
      // specific additional requirement.
      validateGcpEnvAndBuildAuthClient('buildKeyProvider', env)
      if (!env.GCP_KMS_SESSION_KEK) {
        throw new Error(
          "buildKeyProvider: GCP_KMS_SESSION_KEK is required for 'gcp-kms' backend " +
            '(GCP-KMS-IMPLEMENTATION-PLAN.md § G2).',
        )
      }
      throw new Error(
        'GCP backend not yet implemented for session provider (G-PR-2). ' +
          'See output/GCP-KMS-IMPLEMENTATION-PLAN.md § G2.',
      )
    }
    default:
      throw new Error(`buildKeyProvider: unknown A2A_KMS_BACKEND: ${backend}`)
  }
}

/**
 * KMS migration K4 — master-EOA signer backend factory.
 *
 * This is the signing counterpart to `buildKeyProvider`. The two functions
 * are SIBLINGS in the K4 design (§7 of K4 plan): `buildKeyProvider` returns
 * the envelope-encryption provider (K1/K2); `buildSignerBackend` returns
 * the secp256k1 signer for the master-EOA replacement. They share the
 * `A2A_KMS_BACKEND` selector so deployments only have one switch to flip:
 *
 *   - 'local-aes'     → local-secp256k1 (dev). The "local-aes" name applies
 *                       to envelope encryption; the matching signer is real
 *                       secp256k1 with key material read from
 *                       `A2A_MASTER_PRIVATE_KEY`.
 *   - 'aws-kms'       → AWS KMS asymmetric `ECC_SECG_P256K1` signer (K4 PR-2;
 *                       prod target). Requires `AWS_REGION`, `AWS_ROLE_ARN`,
 *                       and `AWS_KMS_SIGNER_KEY_ID` (separate from
 *                       `AWS_KMS_KEY_ID`, the K2 envelope-encryption key).
 *   - 'gcp-kms'       → GCP Cloud KMS asymmetric `EC_SIGN_SECP256K1_SHA256`
 *                       signer (GCP-KMS-IMPLEMENTATION-PLAN § G3). G-PR-1
 *                       wires env validation + auth client; implementation
 *                       lands in G-PR-3.
 *
 * The production guard (`NODE_ENV='production'` + `'local-aes'`) matches
 * `buildKeyProvider`. If the envelope backend is rejected in prod the
 * signer backend must be too.
 */
export function buildSignerBackend(
  env: KeyProviderEnv,
  opts: { audit?: SignerAuditFn } = {},
): KmsAccountBackend {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      "buildSignerBackend: refusing to instantiate 'local-aes' signer in production. " +
        "Set A2A_KMS_BACKEND to 'aws-kms' (K4 PR-2).",
    )
  }

  switch (backend) {
    case 'local-aes': {
      if (!env.A2A_MASTER_PRIVATE_KEY) {
        throw new Error(
          "buildSignerBackend: A2A_MASTER_PRIVATE_KEY is required for the local-secp256k1 signer " +
            "(A2A_KMS_BACKEND='local-aes')",
        )
      }
      return createLocalSecp256k1Signer(
        {
          A2A_MASTER_PRIVATE_KEY: env.A2A_MASTER_PRIVATE_KEY,
          NODE_ENV: env.NODE_ENV,
        },
        { audit: opts.audit },
      )
    }
    case 'aws-kms': {
      // K4 PR-2 — AWS KMS asymmetric secp256k1 signer (prod target).
      //
      // Production guard: NO local fallback. `aws-kms` is THE production
      // target; if env is missing or malformed we throw at startup so an
      // operator gets a clean failure instead of a 503 on the first /
      // session/.../redeem-via-account call. The K4 PR-2 plan §11
      // explicitly forbids a "fallback to local-secp256k1 on KMS
      // unreachable" — same blast-radius argument as K2.
      if (!env.AWS_REGION) {
        throw new Error(
          "buildSignerBackend: AWS_REGION is required for 'aws-kms' signer (K4 PR-2)",
        )
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error(
          "buildSignerBackend: AWS_ROLE_ARN is required for 'aws-kms' signer (K4 PR-2)",
        )
      }
      if (!env.AWS_KMS_SIGNER_KEY_ID) {
        throw new Error(
          "buildSignerBackend: AWS_KMS_SIGNER_KEY_ID is required for 'aws-kms' signer (K4 PR-2) — " +
            'this is a SEPARATE KMS key from AWS_KMS_KEY_ID (the K2 envelope-encryption key).',
        )
      }
      return createAwsKmsSigner(
        {
          AWS_REGION: env.AWS_REGION,
          AWS_ROLE_ARN: env.AWS_ROLE_ARN,
          AWS_KMS_SIGNER_KEY_ID: env.AWS_KMS_SIGNER_KEY_ID,
        },
        { audit: opts.audit },
      )
    }
    case 'gcp-kms': {
      // GCP-KMS G-PR-1 stub for the master EOA signer. Same validate →
      // build-auth-client → throw pattern as buildKeyProvider; the
      // signer-specific identifier is `GCP_KMS_MASTER_SIGNER_VERSION`.
      validateGcpEnvAndBuildAuthClient('buildSignerBackend', env)
      if (!env.GCP_KMS_MASTER_SIGNER_VERSION) {
        throw new Error(
          "buildSignerBackend: GCP_KMS_MASTER_SIGNER_VERSION is required for 'gcp-kms' backend " +
            '(GCP-KMS-IMPLEMENTATION-PLAN.md § G3).',
        )
      }
      throw new Error(
        'GCP backend not yet implemented for master-EOA signer (G-PR-3). ' +
          'See output/GCP-KMS-IMPLEMENTATION-PLAN.md § G3.',
      )
    }
    default:
      throw new Error(`buildSignerBackend: unknown A2A_KMS_BACKEND: ${backend}`)
  }
}

/**
 * KMS migration K5 — per-tool executor signer backend factory.
 *
 * Sibling of `buildSignerBackend` for the master EOA, parameterized by
 * tool id. Each sensitive-tier MCP tool family (`round-awards`,
 * `disbursement`, `pool-lifecycle`, `grant-awards`) gets its OWN signer
 * backend so a compromised key for one family cannot sign for another.
 * IAM scoping (one `kms:Sign` statement per tool KMS ARN) is the
 * security boundary in production.
 *
 * Backend selection mirrors `buildSignerBackend` (same `A2A_KMS_BACKEND`
 * env selector):
 *
 *   - 'local-aes'     → local-secp256k1 reading
 *                       `TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY`. Production
 *                       guard refuses this in `NODE_ENV='production'`.
 *   - 'aws-kms'       → AWS KMS asymmetric `ECC_SECG_P256K1` reading
 *                       `AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID`. Same
 *                       `AWS_REGION` + `AWS_ROLE_ARN` as the master
 *                       signer; the role's policy adds one statement
 *                       per tool key.
 *   - 'gcp-kms'       → GCP Cloud KMS asymmetric secp256k1 per-tool key
 *                       reading `GCP_KMS_TOOL_EXECUTOR_<TOOL_ID>_VERSION`.
 *                       G-PR-1 wires env validation + auth client;
 *                       implementation lands in G-PR-4.
 *
 * Env validation is strict: missing env vars throw at construction time
 * with the exact env name in the error so operators can search their
 * deployment for the missing variable.
 */
export function buildToolExecutorBackend(
  toolId: ToolExecutorId,
  env: KeyProviderEnv,
  opts: { audit?: SignerAuditFn } = {},
): ToolExecutorSignerBackend {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      `buildToolExecutorBackend: refusing to instantiate 'local-aes' signer for tool "${toolId}" in production. ` +
        "Set A2A_KMS_BACKEND='aws-kms' and provision " +
        `${toolEnvKeyName(toolId, 'aws-kms')} (K5).`,
    )
  }

  switch (backend) {
    case 'local-aes': {
      const envName = toolEnvKeyName(toolId, 'local-aes')
      const raw = env[envName]
      if (!raw) {
        throw new Error(
          `buildToolExecutorBackend: ${envName} is required for tool "${toolId}" ` +
            "(A2A_KMS_BACKEND='local-aes')",
        )
      }
      return createToolExecutorSigner(
        toolId,
        {
          A2A_KMS_BACKEND: 'local-aes',
          NODE_ENV: env.NODE_ENV,
          [envName]: raw,
        },
        { audit: opts.audit },
      )
    }
    case 'aws-kms': {
      // K5 prod target. NO local fallback — same blast-radius logic as
      // the master signer: a missing tool key id at startup must throw
      // rather than degrade.
      const envName = toolEnvKeyName(toolId, 'aws-kms')
      const keyId = env[envName]
      if (!env.AWS_REGION) {
        throw new Error(
          `buildToolExecutorBackend: AWS_REGION is required for tool "${toolId}" signer (K5)`,
        )
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error(
          `buildToolExecutorBackend: AWS_ROLE_ARN is required for tool "${toolId}" signer (K5)`,
        )
      }
      if (!keyId) {
        throw new Error(
          `buildToolExecutorBackend: ${envName} is required for tool "${toolId}" signer (K5) — ` +
            'each tool family has its OWN KMS key for defense in depth.',
        )
      }
      return createToolExecutorSigner(
        toolId,
        {
          A2A_KMS_BACKEND: 'aws-kms',
          AWS_REGION: env.AWS_REGION,
          AWS_ROLE_ARN: env.AWS_ROLE_ARN,
          [envName]: keyId,
        },
        { audit: opts.audit },
      )
    }
    case 'gcp-kms': {
      // GCP-KMS G-PR-1 stub for the per-tool executor signer.
      validateGcpEnvAndBuildAuthClient(
        `buildToolExecutorBackend(${toolId})`,
        env,
      )
      const versionEnvName = `GCP_KMS_TOOL_EXECUTOR_${toolId
        .replace(/-/g, '_')
        .toUpperCase()}_VERSION`
      if (!env[versionEnvName]) {
        throw new Error(
          `buildToolExecutorBackend: ${versionEnvName} is required for tool "${toolId}" ` +
            "when A2A_KMS_BACKEND='gcp-kms' " +
            '(GCP-KMS-IMPLEMENTATION-PLAN.md § G4).',
        )
      }
      throw new Error(
        `GCP backend not yet implemented for tool-executor signer "${toolId}" (G-PR-4). ` +
          'See output/GCP-KMS-IMPLEMENTATION-PLAN.md § G4.',
      )
    }
    default:
      throw new Error(
        `buildToolExecutorBackend: unknown A2A_KMS_BACKEND: ${backend}`,
      )
  }
}
