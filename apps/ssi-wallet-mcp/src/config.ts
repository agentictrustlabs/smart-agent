import { readFileSync } from 'node:fs'

try {
  const envFile = readFileSync('.env', 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx)
      const val = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) process.env[key] = val
    }
  }
} catch { /* .env not found */ }

export const config = {
  port: Number(process.env.SSI_WALLET_MCP_PORT ?? '3300'),
  dbPath: process.env.SSI_WALLET_DB_PATH ?? 'ssi-wallet.db',
  askarStorePath: process.env.SSI_ASKAR_STORE_PATH ?? './askar-stores',
  askarKey: process.env.SSI_ASKAR_KEY ?? 'dev-only-key-rotate-in-prod',
  chainId: Number(process.env.CHAIN_ID ?? '31337'),
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  verifyingContract: (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  registryPath: process.env.CREDENTIAL_REGISTRY_PATH ?? './credential-registry.db',
}
