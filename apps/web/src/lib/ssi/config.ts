export const ssiConfig = {
  walletUrl: process.env.SSI_WALLET_MCP_URL ?? 'http://localhost:3300',
  personUrl: process.env.PERSON_MCP_URL ?? 'http://localhost:3200',
  orgUrl: process.env.ORG_MCP_URL ?? 'http://localhost:3400',
  familyUrl: process.env.FAMILY_MCP_URL ?? 'http://localhost:3500',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
  verifierContract: (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  credentialRegistryContract: (process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
}
