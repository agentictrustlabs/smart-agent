// person-mcp absorbed the ssi-wallet routes (provision/credentials/proofs/
// audit/oid4vp/match-against-public-set) post-merge — they live on the same
// port as the MCP tools. `walletUrl` aliases `personUrl` so the existing
// callers keep compiling without a per-file edit.
const personUrl = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

export const ssiConfig = {
  walletUrl: process.env.SSI_WALLET_MCP_URL ?? personUrl,
  personUrl,
  orgUrl: process.env.ORG_MCP_URL ?? 'http://localhost:3400',
  familyUrl: process.env.FAMILY_MCP_URL ?? 'http://localhost:3500',
  geoUrl: process.env.GEO_MCP_URL ?? 'http://localhost:3600',
  verifierUrl: process.env.VERIFIER_MCP_URL ?? 'http://localhost:3700',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
  verifierContract: (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  credentialRegistryContract: (process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
}
