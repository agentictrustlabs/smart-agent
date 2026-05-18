/**
 * @smart-agent/sdk/key-custody — KMS migration K0+K1+K2 barrel.
 *
 * Re-exports the `A2AKeyProvider` interface, the local-aes dev provider,
 * the AWS KMS prod provider (K2 v1 — implementation target), and the
 * shared `canonicalContextBytes` helper.
 *
 * The application depends on `A2AKeyProvider`, not on any specific
 * provider. Which provider gets instantiated is decided by `buildKeyProvider`
 * in `apps/a2a-agent/src/auth/key-provider.ts` via the `A2A_KMS_BACKEND` env.
 */
export type { A2AKeyProvider } from './types'
export { canonicalContextBytes } from './types'
export { createLocalAesProvider } from './local-aes-provider'
export type { LocalAesProviderEnv } from './local-aes-provider'
export { createAwsKmsProvider, extractKmsKeyUuid } from './aws-kms-provider'
export type { AwsKmsEnv, AwsKmsDeps } from './aws-kms-provider'
// K4 PR-1 — local-secp256k1 master-EOA signer + viem LocalAccount adapter.
// The AWS KMS signer (K4 PR-2) lands as a sibling export here.
export {
  createLocalSecp256k1Signer,
  buildCanonicalDigest,
  SECP256K1_N,
  SECP256K1_N_HALF,
} from './local-secp256k1-signer'
export type {
  LocalSecp256k1Env,
  LocalSecp256k1Signer,
  LocalSecp256k1SignerDeps,
  LocalSecp256k1SignerAuditEvent,
} from './local-secp256k1-signer'
export { createKmsAccount } from './viem-kms-account'
export type { KmsAccountBackend, CreateKmsAccountOptions } from './viem-kms-account'
// K4 PR-2 — AWS KMS asymmetric ECC_SECG_P256K1 signer (prod target).
export { createAwsKmsSigner } from './aws-kms-signer'
export type {
  AwsKmsSignerEnv,
  AwsKmsSignerDeps,
  AwsKmsSigner,
  AwsKmsSignerAuditEvent,
} from './aws-kms-signer'
// K5 — per-tool-family executor signer registry. Same primitives as K4
// (createLocalSecp256k1Signer / createAwsKmsSigner) parameterized by
// tool id so each tool family has its OWN KMS key and a separate IAM
// resource scope (defense in depth).
export {
  createToolExecutorSigner,
  isToolExecutorId,
  listToolExecutorIds,
  toolEnvKeyName,
  TOOL_EXECUTOR_IDS,
} from './tool-executor-signer'
export type {
  ToolExecutorId,
  ToolExecutorSignerBackend,
  ToolExecutorSignerEnv,
  ToolExecutorSignerDeps,
} from './tool-executor-signer'
// DER + SPKI utilities (shared by the KMS signer family).
export {
  parseDerSignature,
  extractSec1FromSpki,
  readDerLen,
  stripDerIntegerPad,
  bytesToBigInt,
  bigIntTo32Bytes,
} from './der-utils'
// K3-extension — AWS KMS HMAC provider + local dev counterpart.
export { createAwsKmsMacProvider } from './aws-kms-mac'
export type {
  KmsMacProvider,
  AwsKmsMacEnv,
  AwsKmsMacDeps,
} from './aws-kms-mac'
export { createLocalHmacProvider } from './local-hmac'
export type { LocalHmacEnv } from './local-hmac'
// K3-extension — per-side MAC provider factory used by MCPs / web clients.
export {
  buildMcpMacProvider,
  buildWebMacProvider,
  envKeyForMacKeyId,
  MAC_KEY_IDS,
  MCP_TO_MAC_KEY_ID,
} from './mac-provider-factory'
export type {
  MacKeyId,
  McpName,
  McpMacProviderEnv,
  WebMacKeyId,
} from './mac-provider-factory'
// GCP-KMS G-PR-1 — Workload Identity Federation auth primitive. Actual
// GCP-KMS provider/signer/MAC implementations land in G-PR-2..G-PR-5.
export { createGcpAuthClient, GCP_AUTH_ENV_KEYS } from './gcp-auth'
export type { GcpAuthEnv, GcpAuthDeps } from './gcp-auth'
// GCP-KMS G-PR-2 — session envelope provider (local DEK + KEK-wrap).
export { createGcpKmsProvider } from './gcp-kms-provider'
export type {
  GcpKmsEnv,
  GcpKmsDeps,
  GcpKmsProvider,
  GcpKmsAuditEvent,
  KmsClientLike,
} from './gcp-kms-provider'
// GCP-KMS G-PR-3 — master-EOA secp256k1 signer (KmsAccountBackend impl).
export { createGcpKmsSigner } from './gcp-kms-signer'
export type {
  GcpKmsSignerEnv,
  GcpKmsSignerDeps,
  GcpKmsSigner,
  GcpKmsSignerAuditEvent,
  SignerKmsClientLike,
} from './gcp-kms-signer'
// GCP-KMS G-PR-5 — inter-service MAC provider (KmsMacProvider impl).
export { createGcpKmsMacProvider } from './gcp-kms-mac'
export type {
  GcpKmsMacEnv,
  GcpKmsMacDeps,
  GcpKmsMacProvider,
  MacKmsClientLike,
} from './gcp-kms-mac'
export { crc32c } from './crc32c'
// Sprint 5 W3 P1-3 — out-of-band raw-key AES-256-GCM helpers (test
// fixtures, proposal-body DEK, future migrations). The normal A2A
// session path uses `A2AKeyProvider` instead — see `raw-aes-helpers.ts`
// JSDoc.
export {
  encryptPayloadWithRawKey,
  decryptPayloadWithRawKey,
} from './raw-aes-helpers'
export type {
  RawAesEncryptInput,
  RawAesEncryptOutput,
  RawAesDecryptInput,
} from './raw-aes-helpers'
