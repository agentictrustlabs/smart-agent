/**
 * Spec 004 — Shared OnChainResolver for org-mcp's inline AnonCreds
 * presentation verification.
 *
 * Resolves AnonCreds schema + credDef objects from the on-chain
 * `CredentialRegistry` (the same one issuers like verifier-mcp use).
 *
 * Constructed lazily (and cached) so the verifier doesn't pay the
 * configuration cost on every cold call.
 */

import { OnChainResolver } from '@smart-agent/credential-registry'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
// Env naming compat: deploy-local.sh writes CREDENTIAL_REGISTRY_CONTRACT_ADDRESS;
// earlier code used CREDENTIAL_REGISTRY_ADDRESS. Read both at call time
// (not module load time) so config.ts's .env-injection has had a chance
// to run.
function readCredentialRegistryAddress(): `0x${string}` | undefined {
  return (
    process.env.CREDENTIAL_REGISTRY_ADDRESS
      ?? process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
  ) as `0x${string}` | undefined
}

let cached: OnChainResolver | null = null

export function resolveOnChainResolver(): OnChainResolver {
  if (cached) return cached
  const addr = readCredentialRegistryAddress()
  console.log('[on-chain-resolver] env probe: CREDENTIAL_REGISTRY_ADDRESS=%s CREDENTIAL_REGISTRY_CONTRACT_ADDRESS=%s',
    process.env.CREDENTIAL_REGISTRY_ADDRESS, process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS)
  if (!addr) {
    throw new Error('CREDENTIAL_REGISTRY_ADDRESS env not set — required for AnonCreds presentation verification')
  }
  cached = new OnChainResolver({
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    contractAddress: addr,
  })
  return cached
}
