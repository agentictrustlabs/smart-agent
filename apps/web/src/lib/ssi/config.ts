// Routing rule (phase 3 of A2A-first consolidation):
//
//   `personUrl` / `walletUrl` are RESERVED for two narrow uses:
//     (1) Public protocol endpoints (`/oid4vp/*`, `/oid4vci/*`, `/.well-known/*`)
//         — these are unauthenticated standards endpoints and route direct.
//     (2) Deferred direct-HTTP routes that haven't been wrapped as MCP tools
//         yet (`/wallet/<principal>/<context>`, `/credentials/store`,
//         `/wallet-action/dispatch`, `/session-store/*`). Tracked TODO(phase-4)
//         in their call sites.
//
//   ALL person-mcp /tools/<name> traffic MUST go through the A2A proxy via
//   `callMcp('person', name, args)` from `@/lib/clients/mcp-client`. The
//   `person` client in `clients.ts` enforces this.
//
//   `orgUrl` / `familyUrl` / `geoUrl` / `skillUrl` / `verifierUrl` continue
//   to route direct for issuer/verifier protocol surfaces — they're not
//   user-authenticated tool calls and the A2A proxy currently has no
//   notion of a non-`/tools/` passthrough.
const personUrl = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

export const ssiConfig = {
  walletUrl: process.env.SSI_WALLET_MCP_URL ?? personUrl,
  personUrl,
  orgUrl: process.env.ORG_MCP_URL ?? 'http://localhost:3400',
  familyUrl: process.env.FAMILY_MCP_URL ?? 'http://localhost:3500',
  geoUrl: process.env.GEO_MCP_URL ?? 'http://localhost:3600',
  verifierUrl: process.env.VERIFIER_MCP_URL ?? 'http://localhost:3700',
  skillUrl: process.env.SKILL_MCP_URL ?? 'http://localhost:3800',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
  verifierContract: (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  credentialRegistryContract: (process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
}
