import type { PublicClient, WalletClient } from 'viem'
import { keccak256, toBytes } from 'viem'
import { agentRelationshipAbi, agentAssertionAbi, agentResolverAbi } from './abi'

// ─── Well-Known Relationship Types ──────────────────────────────────

export const ORGANIZATION_GOVERNANCE = keccak256(toBytes('OrganizationGovernance'))
export const ORGANIZATION_MEMBERSHIP = keccak256(toBytes('OrganizationMembership'))
export const ALLIANCE = keccak256(toBytes('Alliance'))
export const VALIDATION_TRUST = keccak256(toBytes('ValidationTrust'))
export const INSURANCE_COVERAGE = keccak256(toBytes('InsuranceCoverage'))
export const COMPLIANCE = keccak256(toBytes('Compliance'))
export const ECONOMIC_SECURITY = keccak256(toBytes('EconomicSecurity'))
export const SERVICE_AGREEMENT = keccak256(toBytes('ServiceAgreement'))
export const DELEGATION_AUTHORITY = keccak256(toBytes('DelegationAuthority'))
export const RUNTIME_ATTESTATION = keccak256(toBytes('RuntimeAttestation'))
export const BUILD_PROVENANCE = keccak256(toBytes('BuildProvenance'))
export const ORGANIZATIONAL_CONTROL = keccak256(toBytes('OrganizationalControl'))
export const ACTIVITY_VALIDATION = keccak256(toBytes('ActivityValidation'))
export const REVIEW_RELATIONSHIP = keccak256(toBytes('ReviewRelationship'))

const REL_TYPE_NAMES: Record<string, string> = {
  [ORGANIZATION_GOVERNANCE]: 'Governance',
  [ORGANIZATION_MEMBERSHIP]: 'Membership',
  [ALLIANCE]: 'Alliance',
  [VALIDATION_TRUST]: 'Validation',
  [INSURANCE_COVERAGE]: 'Insurance',
  [COMPLIANCE]: 'Compliance',
  [ECONOMIC_SECURITY]: 'Economic Security',
  [SERVICE_AGREEMENT]: 'Service',
  [DELEGATION_AUTHORITY]: 'Delegation',
  [RUNTIME_ATTESTATION]: 'Runtime/TEE',
  [BUILD_PROVENANCE]: 'Build Provenance',
  [ORGANIZATIONAL_CONTROL]: 'Org Control',
  [ACTIVITY_VALIDATION]: 'Activity Validation',
  [REVIEW_RELATIONSHIP]: 'Review',
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
export const ROLE_OFFICER = keccak256(toBytes('officer'))
export const ROLE_CHAIR = keccak256(toBytes('chair'))
export const ROLE_ADVISOR = keccak256(toBytes('advisor'))
// Membership
export const ROLE_ADMIN = keccak256(toBytes('admin'))
export const ROLE_MEMBER = keccak256(toBytes('member'))
export const ROLE_OPERATOR = keccak256(toBytes('operator'))
export const ROLE_EMPLOYEE = keccak256(toBytes('employee'))
export const ROLE_CONTRACTOR = keccak256(toBytes('contractor'))
// Assurance
export const ROLE_AUDITOR = keccak256(toBytes('auditor'))
export const ROLE_VALIDATOR = keccak256(toBytes('validator'))
export const ROLE_INSURER = keccak256(toBytes('insurer'))
export const ROLE_INSURED_PARTY = keccak256(toBytes('insured-party'))
export const ROLE_UNDERWRITER = keccak256(toBytes('underwriter'))
export const ROLE_CERTIFIED_BY = keccak256(toBytes('certified-by'))
export const ROLE_LICENSED_BY = keccak256(toBytes('licensed-by'))
// Economic
export const ROLE_STAKER = keccak256(toBytes('staker'))
export const ROLE_GUARANTOR = keccak256(toBytes('guarantor'))
export const ROLE_BACKER = keccak256(toBytes('backer'))
export const ROLE_COLLATERAL_PROVIDER = keccak256(toBytes('collateral-provider'))
// Alliance
export const ROLE_STRATEGIC_PARTNER = keccak256(toBytes('strategic-partner'))
export const ROLE_AFFILIATE = keccak256(toBytes('affiliate'))
export const ROLE_ENDORSED_BY = keccak256(toBytes('endorsed-by'))
export const ROLE_SUBSIDIARY = keccak256(toBytes('subsidiary'))
export const ROLE_PARENT_ORG = keccak256(toBytes('parent-org'))
// Service
export const ROLE_VENDOR = keccak256(toBytes('vendor'))
export const ROLE_SERVICE_PROVIDER = keccak256(toBytes('service-provider'))
export const ROLE_DELEGATED_OPERATOR = keccak256(toBytes('delegated-operator'))
// TEE / Runtime
export const ROLE_RUNS_IN_TEE = keccak256(toBytes('runs-in-tee'))
export const ROLE_ATTESTED_BY = keccak256(toBytes('attested-by'))
export const ROLE_VERIFIED_BY = keccak256(toBytes('verified-by'))
export const ROLE_BOUND_TO_KMS = keccak256(toBytes('bound-to-kms'))
export const ROLE_CONTROLS_RUNTIME = keccak256(toBytes('controls-runtime'))
export const ROLE_BUILT_FROM = keccak256(toBytes('built-from'))
export const ROLE_DEPLOYED_FROM = keccak256(toBytes('deployed-from'))
// Organizational Control
export const ROLE_OPERATED_AGENT = keccak256(toBytes('operated-agent'))
export const ROLE_MANAGED_AGENT = keccak256(toBytes('managed-agent'))
export const ROLE_ADMINISTERS = keccak256(toBytes('administers'))
// Activity Validation
export const ROLE_ACTIVITY_VALIDATOR = keccak256(toBytes('activity-validator'))
export const ROLE_VALIDATED_PERFORMER = keccak256(toBytes('validated-performer'))
// Reviews
export const ROLE_REVIEWER = keccak256(toBytes('reviewer'))
export const ROLE_REVIEWED_AGENT = keccak256(toBytes('reviewed-agent'))

// Issuer types
export const ISSUER_VALIDATOR = keccak256(toBytes('validator'))
export const ISSUER_INSURER = keccak256(toBytes('insurer'))
export const ISSUER_AUDITOR = keccak256(toBytes('auditor'))
export const ISSUER_TEE_VERIFIER = keccak256(toBytes('tee-verifier'))
export const ISSUER_STAKING_POOL = keccak256(toBytes('staking-pool'))
export const ISSUER_GOVERNANCE = keccak256(toBytes('governance'))
export const ISSUER_ORACLE = keccak256(toBytes('oracle'))

// Validation methods
export const VM_SELF_ASSERTED = keccak256(toBytes('self-asserted'))
export const VM_COUNTERPARTY_CONFIRMED = keccak256(toBytes('counterparty-confirmed'))
export const VM_VALIDATOR_VERIFIED = keccak256(toBytes('validator-verified'))
export const VM_INSURER_ISSUED = keccak256(toBytes('insurer-issued'))
export const VM_TEE_ONCHAIN_VERIFIED = keccak256(toBytes('tee-onchain-verified'))
export const VM_TEE_OFFCHAIN_AGGREGATED = keccak256(toBytes('tee-offchain-aggregated'))
export const VM_ZK_VERIFIED = keccak256(toBytes('zk-verified'))
export const VM_REPRODUCIBLE_BUILD = keccak256(toBytes('reproducible-build'))
export const VM_GOVERNANCE_APPROVED = keccak256(toBytes('governance-approved'))

const ALL_ROLE_NAMES: Record<string, string> = {
  [ROLE_OWNER]: 'owner', [ROLE_BOARD_MEMBER]: 'board-member', [ROLE_CEO]: 'ceo',
  [ROLE_EXECUTIVE]: 'executive', [ROLE_TREASURER]: 'treasurer',
  [ROLE_AUTHORIZED_SIGNER]: 'authorized-signer', [ROLE_OFFICER]: 'officer',
  [ROLE_CHAIR]: 'chair', [ROLE_ADVISOR]: 'advisor',
  [ROLE_ADMIN]: 'admin', [ROLE_MEMBER]: 'member', [ROLE_OPERATOR]: 'operator',
  [ROLE_EMPLOYEE]: 'employee', [ROLE_CONTRACTOR]: 'contractor',
  [ROLE_AUDITOR]: 'auditor', [ROLE_VALIDATOR]: 'validator',
  [ROLE_INSURER]: 'insurer', [ROLE_INSURED_PARTY]: 'insured-party',
  [ROLE_UNDERWRITER]: 'underwriter', [ROLE_CERTIFIED_BY]: 'certified-by',
  [ROLE_LICENSED_BY]: 'licensed-by',
  [ROLE_STAKER]: 'staker', [ROLE_GUARANTOR]: 'guarantor',
  [ROLE_BACKER]: 'backer', [ROLE_COLLATERAL_PROVIDER]: 'collateral-provider',
  [ROLE_STRATEGIC_PARTNER]: 'strategic-partner', [ROLE_AFFILIATE]: 'affiliate',
  [ROLE_ENDORSED_BY]: 'endorsed-by', [ROLE_SUBSIDIARY]: 'subsidiary',
  [ROLE_PARENT_ORG]: 'parent-org',
  [ROLE_VENDOR]: 'vendor', [ROLE_SERVICE_PROVIDER]: 'service-provider',
  [ROLE_DELEGATED_OPERATOR]: 'delegated-operator',
  [ROLE_RUNS_IN_TEE]: 'runs-in-tee', [ROLE_ATTESTED_BY]: 'attested-by',
  [ROLE_VERIFIED_BY]: 'verified-by', [ROLE_BOUND_TO_KMS]: 'bound-to-kms',
  [ROLE_CONTROLS_RUNTIME]: 'controls-runtime',
  [ROLE_BUILT_FROM]: 'built-from', [ROLE_DEPLOYED_FROM]: 'deployed-from',
  [ROLE_OPERATED_AGENT]: 'operated-agent', [ROLE_MANAGED_AGENT]: 'managed-agent',
  [ROLE_ADMINISTERS]: 'administers',
  [ROLE_ACTIVITY_VALIDATOR]: 'activity-validator', [ROLE_VALIDATED_PERFORMER]: 'validated-performer',
  [ROLE_REVIEWER]: 'reviewer', [ROLE_REVIEWED_AGENT]: 'reviewed-agent',
}

export function roleName(hash: `0x${string}`): string {
  return ALL_ROLE_NAMES[hash] ?? `custom(${hash.slice(0, 10)})`
}

const ISSUER_TYPE_NAMES: Record<string, string> = {
  [ISSUER_VALIDATOR]: 'validator', [ISSUER_INSURER]: 'insurer',
  [ISSUER_AUDITOR]: 'auditor', [ISSUER_TEE_VERIFIER]: 'tee-verifier',
  [ISSUER_STAKING_POOL]: 'staking-pool', [ISSUER_GOVERNANCE]: 'governance',
  [ISSUER_ORACLE]: 'oracle',
}

export function issuerTypeName(hash: `0x${string}`): string {
  return ISSUER_TYPE_NAMES[hash] ?? `custom(${hash.slice(0, 10)})`
}

const VM_NAMES: Record<string, string> = {
  [VM_SELF_ASSERTED]: 'self-asserted', [VM_COUNTERPARTY_CONFIRMED]: 'counterparty',
  [VM_VALIDATOR_VERIFIED]: 'validator-verified', [VM_INSURER_ISSUED]: 'insurer-issued',
  [VM_TEE_ONCHAIN_VERIFIED]: 'tee-onchain', [VM_TEE_OFFCHAIN_AGGREGATED]: 'tee-offchain',
  [VM_ZK_VERIFIED]: 'zk-verified', [VM_REPRODUCIBLE_BUILD]: 'reproducible-build',
  [VM_GOVERNANCE_APPROVED]: 'governance-approved',
}

export function validationMethodName(hash: `0x${string}`): string {
  return VM_NAMES[hash] ?? `custom(${hash.slice(0, 10)})`
}

// ─── Edge Status ────────────────────────────────────────────────────

export const EdgeStatus = {
  NONE: 0,
  PROPOSED: 1,
  CONFIRMED: 2,
  ACTIVE: 3,
  SUSPENDED: 4,
  REVOKED: 5,
  REJECTED: 6,
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
