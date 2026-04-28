import { readFileSync } from 'node:fs'
try {
  const envFile = readFileSync('.env', 'utf-8')
  for (const line of envFile.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) {
      const k = t.slice(0, i); const v = t.slice(i + 1)
      if (!process.env[k]) process.env[k] = v
    }
  }
} catch { /* .env not found */ }

const requiredAddress = process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
if (!requiredAddress) {
  throw new Error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS env is required')
}

export const config = {
  port: Number(process.env.SKILL_MCP_PORT ?? '3800'),
  displayName: process.env.SKILL_DISPLAY_NAME ?? 'Smart Agent Skill Steward',
  /**
   * Issuer key. Mirrors GEO_PRIVATE_KEY but distinct so we have a
   * separate issuer DID. v1 of the security model (signed in-repo
   * manifest) ships this key under a known address; the on-chain
   * SkillIssuerRegistry deferred to a later milestone replaces this
   * with stake/slashing.
   */
  privateKey: (process.env.SKILL_PRIVATE_KEY ?? ('0x' + 'd'.repeat(64))) as `0x${string}`,
  chainId: Number(process.env.SKILL_CHAIN_ID ?? '31337'),
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
  credentialRegistryAddress: requiredAddress as `0x${string}`,
  privateStorePath: process.env.SKILL_PRIVATE_STORE_PATH ?? './skill-private.db',
  issuerBaseUrl: process.env.SKILL_ISSUER_BASE_URL ?? 'http://localhost:3800',
}
