import type { PublicClient, WalletClient } from 'viem'
import { keccak256, toBytes } from 'viem'
import { agentRelationshipAbi, agentAssertionAbi, agentResolverAbi } from './abi'

// ─── Well-Known Relationship Types ──────────────────────────────────

export const ORGANIZATION_GOVERNANCE = keccak256(toBytes('OrganizationGovernance'))
export const ORGANIZATION_MEMBERSHIP = keccak256(toBytes('OrganizationMembership'))
export const ALLIANCE = keccak256(toBytes('Alliance'))
export const VALIDATION_TRUST = keccak256(toBytes('ValidationTrust'))
export const INSURANCE_COVERAGE = keccak256(toBytes('InsuranceCoverage'))
export const ECONOMIC_SECURITY = keccak256(toBytes('EconomicSecurity'))
export const SERVICE_AGREEMENT = keccak256(toBytes('ServiceAgreement'))
export const DELEGATION_AUTHORITY = keccak256(toBytes('DelegationAuthority'))

const REL_TYPE_NAMES: Record<string, string> = {
  [ORGANIZATION_GOVERNANCE]: 'Governance',
  [ORGANIZATION_MEMBERSHIP]: 'Membership',
  [ALLIANCE]: 'Alliance',
  [VALIDATION_TRUST]: 'Validation',
  [INSURANCE_COVERAGE]: 'Insurance',
  [ECONOMIC_SECURITY]: 'Economic Security',
  [SERVICE_AGREEMENT]: 'Service',
  [DELEGATION_AUTHORITY]: 'Delegation',
}

export function relationshipTypeName(hash: `0x${string}`): string {
  return REL_TYPE_NAMES[hash] ?? `custom(${hash.slice(0, 10)})`
}

// ─── Well-Known Roles ───────────────────────────────────────────────

// Governance
export const ROLE_OWNER = keccak256(toBytes('owner'))
export const ROLE_BOARD_MEMBER = keccak256(toBytes('board-member'))
export const ROLE_CEO = keccak256(toBytes('ceo'))
export const ROLE_EXECUTIVE = keccak256(toBytes('executive'))
export const ROLE_TREASURER = keccak256(toBytes('treasurer'))
export const ROLE_AUTHORIZED_SIGNER = keccak256(toBytes('authorized-signer'))
// Membership
export const ROLE_ADMIN = keccak256(toBytes('admin'))
export const ROLE_MEMBER = keccak256(toBytes('member'))
export const ROLE_OPERATOR = keccak256(toBytes('operator'))
// Assurance
export const ROLE_AUDITOR = keccak256(toBytes('auditor'))
export const ROLE_VALIDATOR = keccak256(toBytes('validator'))
export const ROLE_INSURER = keccak256(toBytes('insurer'))
export const ROLE_INSURED_PARTY = keccak256(toBytes('insured-party'))
// Economic
export const ROLE_STAKER = keccak256(toBytes('staker'))
export const ROLE_GUARANTOR = keccak256(toBytes('guarantor'))
// Alliance
export const ROLE_STRATEGIC_PARTNER = keccak256(toBytes('strategic-partner'))
export const ROLE_AFFILIATE = keccak256(toBytes('affiliate'))
// Service
export const ROLE_VENDOR = keccak256(toBytes('vendor'))
export const ROLE_SERVICE_PROVIDER = keccak256(toBytes('service-provider'))
export const ROLE_DELEGATED_OPERATOR = keccak256(toBytes('delegated-operator'))

const ROLE_NAMES: Record<string, string> = {
  [ROLE_OWNER]: 'owner', [ROLE_BOARD_MEMBER]: 'board-member', [ROLE_CEO]: 'ceo',
  [ROLE_EXECUTIVE]: 'executive', [ROLE_TREASURER]: 'treasurer',
  [ROLE_AUTHORIZED_SIGNER]: 'authorized-signer', [ROLE_ADMIN]: 'admin',
  [ROLE_MEMBER]: 'member', [ROLE_OPERATOR]: 'operator', [ROLE_AUDITOR]: 'auditor',
  [ROLE_VALIDATOR]: 'validator', [ROLE_INSURER]: 'insurer',
  [ROLE_INSURED_PARTY]: 'insured-party', [ROLE_STAKER]: 'staker',
  [ROLE_GUARANTOR]: 'guarantor', [ROLE_STRATEGIC_PARTNER]: 'strategic-partner',
  [ROLE_AFFILIATE]: 'affiliate', [ROLE_VENDOR]: 'vendor',
  [ROLE_SERVICE_PROVIDER]: 'service-provider', [ROLE_DELEGATED_OPERATOR]: 'delegated-operator',
}

export function roleName(hash: `0x${string}`): string {
  return ROLE_NAMES[hash] ?? `custom(${hash.slice(0, 10)})`
}

// ─── Edge Status ────────────────────────────────────────────────────

export const EdgeStatus = {
  NONE: 0,
  PROPOSED: 1,
  ACTIVE: 2,
  SUSPENDED: 3,
  REVOKED: 4,
} as const

// ─── Assertion Types ────────────────────────────────────────────────

export const AssertionType = {
  NONE: 0,
  SELF_ASSERTED: 1,
  OBJECT_ASSERTED: 2,
  MUTUAL_CONFIRMATION: 3,
  VALIDATOR_ASSERTED: 4,
  ORG_ASSERTED: 5,
  APP_ASSERTED: 6,
} as const

// ─── Resolution Modes ───────────────────────────────────────────────

export const ResolutionMode = {
  EDGE_ACTIVE_ONLY: 0,
  REQUIRE_ANY_VALID_ASSERTION: 1,
  REQUIRE_OBJECT_ASSERTION: 2,
  REQUIRE_MUTUAL_ASSERTION: 3,
  REQUIRE_VALIDATOR_ASSERTION: 4,
} as const

// ─── DID Helper ─────────────────────────────────────────────────────

export function toDidEthr(chainId: number, address: `0x${string}`): string {
  return `did:ethr:${chainId}:${address}`
}

// ─── On-Chain Types ─────────────────────────────────────────────────

export interface OnChainEdge {
  edgeId: `0x${string}`
  subject: `0x${string}`
  object_: `0x${string}`
  role: `0x${string}`
  relationshipType: `0x${string}`
  status: number
  createdBy: `0x${string}`
  createdAt: bigint
  updatedAt: bigint
  metadataURI: string
}

export interface OnChainAssertion {
  assertionId: bigint
  edgeId: `0x${string}`
  assertionType: number
  asserter: `0x${string}`
  validFrom: bigint
  validUntil: bigint
  revoked: boolean
  evidenceURI: string
}

// ─── Protocol Config ────────────────────────────────────────────────

export interface RelationshipProtocolConfig {
  publicClient: PublicClient
  walletClient: WalletClient
  relationshipAddress: `0x${string}`
  assertionAddress: `0x${string}`
  resolverAddress: `0x${string}`
}

/**
 * Client for the 3-contract relationship protocol:
 * - AgentRelationship (edges)
 * - AgentAssertion (provenance)
 * - AgentRelationshipResolver (policy)
 */
export class RelationshipProtocolClient {
  private pub: PublicClient
  private wal: WalletClient
  private relAddr: `0x${string}`
  private assertAddr: `0x${string}`
  private resolverAddr: `0x${string}`

  constructor(config: RelationshipProtocolConfig) {
    this.pub = config.publicClient
    this.wal = config.walletClient
    this.relAddr = config.relationshipAddress
    this.assertAddr = config.assertionAddress
    this.resolverAddr = config.resolverAddress
  }

  // ─── Edge Layer ─────────────────────────────────────────────────

  async createEdge(params: {
    subject: `0x${string}`
    object: `0x${string}`
    relationshipType: `0x${string}`
    initialRoles?: `0x${string}`[]
    metadataURI?: string
  }): Promise<`0x${string}`> {
    const hash = await this.wal.writeContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'createEdge',
      args: [params.subject, params.object, params.relationshipType, params.initialRoles ?? [], params.metadataURI ?? ''],
      chain: this.wal.chain,
      account: this.wal.account!,
    })
    await this.pub.waitForTransactionReceipt({ hash })

    return (await this.pub.readContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'computeEdgeId',
      args: [params.subject, params.object, params.relationshipType],
    })) as `0x${string}`
  }

  async addRole(edgeId: `0x${string}`, role: `0x${string}`): Promise<void> {
    const hash = await this.wal.writeContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'addRole',
      args: [edgeId, role],
      chain: this.wal.chain,
      account: this.wal.account!,
    })
    await this.pub.waitForTransactionReceipt({ hash })
  }

  async removeRole(edgeId: `0x${string}`, role: `0x${string}`): Promise<void> {
    const hash = await this.wal.writeContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'removeRole',
      args: [edgeId, role],
      chain: this.wal.chain,
      account: this.wal.account!,
    })
    await this.pub.waitForTransactionReceipt({ hash })
  }

  async getRoles(edgeId: `0x${string}`): Promise<`0x${string}`[]> {
    return (await this.pub.readContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'getRoles',
      args: [edgeId],
    })) as `0x${string}`[]
  }

  async setEdgeStatus(edgeId: `0x${string}`, status: number): Promise<void> {
    const hash = await this.wal.writeContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'setEdgeStatus',
      args: [edgeId, status],
      chain: this.wal.chain,
      account: this.wal.account!,
    })
    await this.pub.waitForTransactionReceipt({ hash })
  }

  async getEdge(edgeId: `0x${string}`): Promise<OnChainEdge> {
    return (await this.pub.readContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'getEdge',
      args: [edgeId],
    })) as unknown as OnChainEdge
  }

  async getEdgesByObject(object: `0x${string}`): Promise<`0x${string}`[]> {
    return (await this.pub.readContract({
      address: this.relAddr,
      abi: agentRelationshipAbi,
      functionName: 'getEdgesByObject',
      args: [object],
    })) as `0x${string}`[]
  }

  // ─── Assertion Layer ────────────────────────────────────────────

  async makeAssertion(params: {
    edgeId: `0x${string}`
    assertionType: number
    validFrom?: number
    validUntil?: number
    evidenceURI?: string
  }): Promise<void> {
    const hash = await this.wal.writeContract({
      address: this.assertAddr,
      abi: agentAssertionAbi,
      functionName: 'makeAssertion',
      args: [params.edgeId, params.assertionType, BigInt(params.validFrom ?? 0), BigInt(params.validUntil ?? 0), params.evidenceURI ?? ''],
      chain: this.wal.chain,
      account: this.wal.account!,
    })
    await this.pub.waitForTransactionReceipt({ hash })
  }

  async getAssertionsByEdge(edgeId: `0x${string}`): Promise<bigint[]> {
    return (await this.pub.readContract({
      address: this.assertAddr,
      abi: agentAssertionAbi,
      functionName: 'getAssertionsByEdge',
      args: [edgeId],
    })) as bigint[]
  }

  async getAssertion(id: bigint): Promise<OnChainAssertion> {
    return (await this.pub.readContract({
      address: this.assertAddr,
      abi: agentAssertionAbi,
      functionName: 'getAssertion',
      args: [id],
    })) as unknown as OnChainAssertion
  }

  // ─── Resolver Layer ─────────────────────────────────────────────

  async holdsRole(params: {
    subject: `0x${string}`
    object: `0x${string}`
    role: `0x${string}`
    relationshipType: `0x${string}`
    mode?: number
  }): Promise<boolean> {
    return (await this.pub.readContract({
      address: this.resolverAddr,
      abi: agentResolverAbi,
      functionName: 'holdsRole',
      args: [params.subject, params.object, params.role, params.relationshipType, params.mode ?? ResolutionMode.EDGE_ACTIVE_ONLY],
    })) as boolean
  }

  async getActiveRoles(params: {
    subject: `0x${string}`
    object: `0x${string}`
    relationshipType: `0x${string}`
    mode?: number
  }): Promise<`0x${string}`[]> {
    return (await this.pub.readContract({
      address: this.resolverAddr,
      abi: agentResolverAbi,
      functionName: 'getActiveRoles',
      args: [params.subject, params.object, params.relationshipType, params.mode ?? ResolutionMode.EDGE_ACTIVE_ONLY],
    })) as `0x${string}`[]
  }
}
