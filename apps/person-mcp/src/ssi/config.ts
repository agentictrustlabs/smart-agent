/**
 * ssi-wallet config — was previously a separate process. After the merge into
 * person-mcp, the config object continues to exist with the same shape so the
 * absorbed storage/registry/auth modules don't need internal edits.
 *
 * Values are read from process.env, which is loaded once by person-mcp's
 * index.ts via its own .env loader.
 */

const registryAddr = process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
if (!registryAddr) {
  throw new Error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS env is required')
}

export const config = {
  port: Number(process.env.PERSON_MCP_PORT ?? '3200'),
  /** Person-mcp's own SQLite path — both the drizzle layer and the absorbed
   *  ssi storage modules write into the same file. */
  dbPath: process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.db',
  askarStorePath: process.env.SSI_ASKAR_STORE_PATH ?? './askar-stores',
  askarKey: process.env.SSI_ASKAR_KEY ?? 'dev-only-key-rotate-in-prod',
  chainId: Number(process.env.CHAIN_ID ?? '31337'),
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  verifyingContract: (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  credentialRegistryAddress: registryAddr as `0x${string}`,
}
