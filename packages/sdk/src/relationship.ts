import type { PublicClient, WalletClient } from 'viem'
import { keccak256, toBytes } from 'viem'
import { agentRelationshipAbi, agentAssertionAbi, agentResolverAbi } from './abi'
export {
  hashTaxonomyTerm,
  listRelationshipTypeDefinitions,
  listRoleDefinitions,
  getRelationshipTypeDefinitionByKey,
  getRelationshipTypeDefinitionByHash,
  getRoleDefinitionByKey,
  getRoleDefinitionByHash,
  getDelegationPolicyDefinitionByKey,
  getDelegationPolicyDefinitionForTerms,
  listRoleDefinitionsForRelationshipType,
  getInviteRoleDefinition,
  relationshipTypeName,
  roleName,
  ORGANIZATION_GOVERNANCE,
  ORGANIZATION_MEMBERSHIP,
  ALLIANCE,
  VALIDATION_TRUST,
  INSURANCE_COVERAGE,
  COMPLIANCE,
  ECONOMIC_SECURITY,
  SERVICE_AGREEMENT,
  DELEGATION_AUTHORITY,
  RUNTIME_ATTESTATION,
  BUILD_PROVENANCE,
  ORGANIZATIONAL_CONTROL,
  ACTIVITY_VALIDATION,
  REVIEW_RELATIONSHIP,
  HAS_MEMBER,
  ROLE_OWNER,
  ROLE_BOARD_MEMBER,
  ROLE_CEO,
  ROLE_EXECUTIVE,
  ROLE_TREASURER,
  ROLE_AUTHORIZED_SIGNER,
  ROLE_OFFICER,
  ROLE_CHAIR,
  ROLE_ADVISOR,
  ROLE_ADMIN,
  ROLE_MEMBER,
  ROLE_OPERATOR,
  ROLE_EMPLOYEE,
  ROLE_CONTRACTOR,
  ROLE_AUDITOR,
  ROLE_VALIDATOR,
  ROLE_INSURER,
  ROLE_INSURED_PARTY,
  ROLE_UNDERWRITER,
  ROLE_CERTIFIED_BY,
  ROLE_LICENSED_BY,
  ROLE_STAKER,
  ROLE_GUARANTOR,
  ROLE_BACKER,
  ROLE_COLLATERAL_PROVIDER,
  ROLE_STRATEGIC_PARTNER,
  ROLE_AFFILIATE,
  ROLE_ENDORSED_BY,
  ROLE_SUBSIDIARY,
  ROLE_PARENT_ORG,
  ROLE_VENDOR,
  ROLE_SERVICE_PROVIDER,
  ROLE_DELEGATED_OPERATOR,
  ROLE_RUNS_IN_TEE,
  ROLE_ATTESTED_BY,
  ROLE_VERIFIED_BY,
  ROLE_BOUND_TO_KMS,
  ROLE_CONTROLS_RUNTIME,
  ROLE_BUILT_FROM,
  ROLE_DEPLOYED_FROM,
  ROLE_OPERATED_AGENT,
  ROLE_MANAGED_AGENT,
  ROLE_ADMINISTERS,
  ROLE_ACTIVITY_VALIDATOR,
  ROLE_VALIDATED_PERFORMER,
  ROLE_REVIEWER,
  ROLE_REVIEWED_AGENT,
} from './relationship-taxonomy'

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
