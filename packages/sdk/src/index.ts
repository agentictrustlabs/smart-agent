// ─── ABIs ────────────────────────────────────────────────────────────
export {
  agentRootAccountAbi,
  agentAccountFactoryAbi,
  delegationManagerAbi,
  agentRelationshipAbi,
  agentAssertionAbi,
  agentResolverAbi,
} from './abi'

// ─── Account Client ──────────────────────────────────────────────────
export { AgentAccountClient } from './account'
export type { AgentAccountClientConfig } from './account'

// ─── Delegation Client ───────────────────────────────────────────────
export {
  DelegationClient,
  ROOT_AUTHORITY,
  encodeTimestampTerms,
  encodeValueTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  buildCaveat,
} from './delegation'
export type { DelegationClientConfig } from './delegation'

// ─── Sessions ────────────────────────────────────────────────────────
export { createAgentSession, isSessionValid } from './session'

// ─── Relationship Protocol (3-contract) ──────────────────────────────
export {
  RelationshipProtocolClient,
  // Relationship types
  ORGANIZATION_GOVERNANCE,
  ORGANIZATION_MEMBERSHIP,
  ALLIANCE,
  VALIDATION_TRUST,
  INSURANCE_COVERAGE,
  ECONOMIC_SECURITY,
  SERVICE_AGREEMENT,
  DELEGATION_AUTHORITY,
  // Roles
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_CEO, ROLE_EXECUTIVE,
  ROLE_TREASURER, ROLE_AUTHORIZED_SIGNER,
  ROLE_ADMIN, ROLE_MEMBER, ROLE_OPERATOR,
  ROLE_AUDITOR, ROLE_VALIDATOR, ROLE_INSURER, ROLE_INSURED_PARTY,
  ROLE_STAKER, ROLE_GUARANTOR,
  ROLE_STRATEGIC_PARTNER, ROLE_AFFILIATE,
  ROLE_VENDOR, ROLE_SERVICE_PROVIDER, ROLE_DELEGATED_OPERATOR,
  // Enums
  EdgeStatus,
  AssertionType,
  ResolutionMode,
  // Helpers
  roleName,
  relationshipTypeName,
  toDidEthr,
} from './relationship'
export type {
  RelationshipProtocolConfig,
  OnChainEdge,
  OnChainAssertion,
} from './relationship'

// ─── Re-export types ─────────────────────────────────────────────────
export type {
  AgentAccount,
  CreateAgentAccountParams,
  Delegation,
  Caveat,
  CaveatType,
  AgentSession,
  CreateSessionParams,
  SessionPackage,
  SessionStatus,
  AutonomyMode,
  DeployedContracts,
  AgentMetadata,
  PackedUserOperation,
} from '@smart-agent/types'

export { SUPPORTED_CHAINS, ENTRYPOINT_V07_ADDRESS } from '@smart-agent/types'
