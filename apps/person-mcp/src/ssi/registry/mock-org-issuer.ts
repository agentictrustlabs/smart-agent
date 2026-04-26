/**
 * Mock OrgMembershipCredential issuer for harnesses.
 *
 * Wraps the real IssuerAgent so harness scenarios can mint OrgMembership
 * credentials without standing up the full org-mcp service. Issuer state lives
 * on-chain in CredentialRegistry; the private material lives in a local file.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { IssuerAgent } from '@smart-agent/privacy-creds'

/** Deterministic dev key so we get a stable issuer EOA across resets. */
const MOCK_ISSUER_PRIVATE_KEY =
  (process.env.CATALYST_ISSUER_PRIVATE_KEY as `0x${string}` | undefined) ??
  ('0x' + 'c'.repeat(64)) as `0x${string}`

const mockIssuerAccount = privateKeyToAccount(MOCK_ISSUER_PRIVATE_KEY)
export const CATALYST_ISSUER_ADDRESS = mockIssuerAccount.address
const chainId = Number(process.env.CHAIN_ID ?? process.env.ORG_CHAIN_ID ?? '31337')
export const CATALYST_ISSUER_ID = `did:ethr:${chainId}:${CATALYST_ISSUER_ADDRESS.toLowerCase()}` as const

export const MEMBERSHIP_SCHEMA_ID = 'https://catalyst.noco.org/schemas/OrgMembership/1.0'
export const MEMBERSHIP_CRED_DEF_ID = 'https://catalyst.noco.org/creddefs/OrgMembership/1.0/v1'

export interface MembershipAttributes {
  membershipStatus: 'active' | 'inactive' | 'suspended'
  role: string
  joinedYear: string
  circleId: string
}

export interface OrgIssuer {
  ensureSchemaAndCredDef: () => Promise<void>
  createOffer: () => Promise<string>
  issue: (
    credentialOfferJson: string,
    credentialRequestJson: string,
    attrs: MembershipAttributes,
  ) => Promise<string>
}

export interface MockOrgIssuerConfig {
  /** RPC URL pointing at the chain with CredentialRegistry. */
  rpcUrl: string
  /** Address of CredentialRegistry on that chain. */
  credentialRegistryAddress: `0x${string}`
  /** did:ethr:<chainId>:<address>. Defaults to CATALYST_ISSUER_ID. */
  issuerId?: string
  /** Private SQLite path for credDef-private + KCP material. */
  privateStorePath: string
}

export function mockOrgIssuer(cfg: MockOrgIssuerConfig): OrgIssuer {
  const issuerId = cfg.issuerId ?? CATALYST_ISSUER_ID
  const agent = new IssuerAgent({
    did: issuerId,
    privateKey: MOCK_ISSUER_PRIVATE_KEY,
    displayName: 'Catalyst NoCo Network (mock)',
    rpcUrl: cfg.rpcUrl,
    chainId,
    credentialRegistryAddress: cfg.credentialRegistryAddress,
    privateStorePath: cfg.privateStorePath,
  })

  const spec = {
    schemaId: MEMBERSHIP_SCHEMA_ID,
    credDefId: MEMBERSHIP_CRED_DEF_ID,
    name: 'OrgMembership',
    version: '1.0',
    attributeNames: ['membershipStatus', 'role', 'joinedYear', 'circleId'],
  }

  return {
    ensureSchemaAndCredDef: () => agent.ensureSchemaAndCredDef(spec),
    createOffer: () => agent.createOffer(MEMBERSHIP_CRED_DEF_ID),
    issue: (offer, request, attrs) => agent.issue(MEMBERSHIP_CRED_DEF_ID, offer, request, {
      membershipStatus: attrs.membershipStatus,
      role: attrs.role,
      joinedYear: attrs.joinedYear,
      circleId: attrs.circleId,
    }),
  }
}
