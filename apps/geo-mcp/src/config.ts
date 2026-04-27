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
  port: Number(process.env.GEO_MCP_PORT ?? '3600'),
  displayName: process.env.GEO_DISPLAY_NAME ?? 'Smart Agent Geo Steward',
  privateKey: (process.env.GEO_PRIVATE_KEY ?? ('0x' + 'e'.repeat(64))) as `0x${string}`,
  chainId: Number(process.env.GEO_CHAIN_ID ?? '31337'),
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
  credentialRegistryAddress: requiredAddress as `0x${string}`,
  privateStorePath: process.env.GEO_PRIVATE_STORE_PATH ?? './geo-private.db',
  issuerBaseUrl: process.env.GEO_ISSUER_BASE_URL ?? 'http://localhost:3600',
}
