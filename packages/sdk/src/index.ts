// ─── ABIs ────────────────────────────────────────────────────────────
export {
  agentAccountAbi,
  agentAccountFactoryAbi,
  delegationManagerAbi,
  agentRelationshipAbi,
  agentAssertionAbi,
  agentResolverAbi,
  agentTemplateAbi,
  agentIssuerProfileAbi,
  agentValidationProfileAbi,
  agentReviewRecordAbi,
  agentDisputeRecordAbi,
  agentTrustProfileAbi,
  agentControlAbi,
  mockTeeVerifierAbi,
  ontologyTermRegistryAbi,
  agentAccountResolverAbi,
  agentUniversalResolverAbi,
  relationshipTypeRegistryAbi,
  agentRelationshipQueryAbi,
  agentNameRegistryAbi,
  agentNameResolverAbi,
  agentNameUniversalResolverAbi,
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
  encodeRateLimitTerms,
  buildCaveat,
  // EIP-712 delegation hashing (matches DelegationManager contract)
  hashDelegation,
  hashCaveats,
  delegationDomainSeparator,
  // Caveat term decoders
  decodeTimestampTerms,
  decodeValueTerms,
  decodeAllowedTargetsTerms,
  decodeAllowedMethodsTerms,
  // MCP tool scope caveat
  MCP_TOOL_SCOPE_ENFORCER,
  encodeMcpToolScopeTerms,
  decodeMcpToolScopeTerms,
  buildMcpToolScopeCaveat,
  // Data scope caveat (cross-principal data access)
  DATA_SCOPE_ENFORCER,
  encodeDataScopeTerms,
  decodeDataScopeTerms,
  buildDataScopeCaveat,
} from './delegation'
export type { DataScopeGrant } from './delegation'
export type { DelegationClientConfig } from './delegation'

// ─── Sessions ────────────────────────────────────────────────────────
export { createAgentSession, isSessionValid } from './session'

// ─── Crypto (session encryption, HMAC) ──────────────────────────────
export { encryptPayload, decryptPayload, randomHex, hmacSign, hmacVerify } from './crypto'
export type { EncryptedPayload } from './crypto'

// ─── Challenge Authentication ───────────────────────────────────────
export { createChallenge, isChallengeExpired, hashChallenge, A2A_AUTH_DOMAIN, CHALLENGE_TYPES } from './challenge'
export type { ChallengeData } from './challenge'

// ─── Delegation Tokens (A2A → MCP) ─────────────────────────────────
export { mintDelegationToken, verifyDelegationToken, claimsCanonicalString } from './delegation-token'
export type { DelegationTokenClaims, DelegationTokenEnvelope, DelegationTokenVerification } from './delegation-token'

// ─── Relationship Protocol (3-contract) ──────────────────────────────
export {
  RelationshipProtocolClient,
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
  // Relationship types
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, ALLIANCE,
  VALIDATION_TRUST, INSURANCE_COVERAGE, COMPLIANCE,
  ECONOMIC_SECURITY, SERVICE_AGREEMENT, DELEGATION_AUTHORITY,
  RUNTIME_ATTESTATION, BUILD_PROVENANCE,
  ORGANIZATIONAL_CONTROL, ACTIVITY_VALIDATION, REVIEW_RELATIONSHIP, HAS_MEMBER, GENERATIONAL_LINEAGE,
  // Governance roles
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_CEO, ROLE_EXECUTIVE,
  ROLE_TREASURER, ROLE_AUTHORIZED_SIGNER, ROLE_OFFICER, ROLE_CHAIR, ROLE_ADVISOR,
  // Membership roles
  ROLE_ADMIN, ROLE_MEMBER, ROLE_OPERATOR, ROLE_EMPLOYEE, ROLE_CONTRACTOR,
  // Assurance roles
  ROLE_AUDITOR, ROLE_VALIDATOR, ROLE_INSURER, ROLE_INSURED_PARTY,
  ROLE_UNDERWRITER, ROLE_CERTIFIED_BY, ROLE_LICENSED_BY,
  // Economic roles
  ROLE_STAKER, ROLE_GUARANTOR, ROLE_BACKER, ROLE_COLLATERAL_PROVIDER,
  // Alliance roles
  ROLE_STRATEGIC_PARTNER, ROLE_AFFILIATE, ROLE_ENDORSED_BY, ROLE_SUBSIDIARY, ROLE_PARENT_ORG,
  // Generational lineage roles
  ROLE_UPSTREAM, ROLE_DOWNSTREAM,
  // Coaching & influence
  COACHING_MENTORSHIP, PERSONAL_INFLUENCE,
  ROLE_COACH, ROLE_DISCIPLE, ROLE_INFLUENCER, ROLE_INFLUENCE_CONTACT,
  // Data access delegation
  DATA_ACCESS_DELEGATION, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE,
  // Naming hierarchy
  NAMESPACE_CONTAINS, ROLE_NAMESPACE_PARENT, ROLE_NAMESPACE_CHILD,
  // Service roles
  ROLE_VENDOR, ROLE_SERVICE_PROVIDER, ROLE_DELEGATED_OPERATOR,
  // TEE/Runtime roles
  ROLE_RUNS_IN_TEE, ROLE_ATTESTED_BY, ROLE_VERIFIED_BY, ROLE_BOUND_TO_KMS,
  ROLE_CONTROLS_RUNTIME, ROLE_BUILT_FROM, ROLE_DEPLOYED_FROM,
  // Org control roles
  ROLE_OPERATED_AGENT, ROLE_MANAGED_AGENT, ROLE_ADMINISTERS,
  // Activity validation roles
  ROLE_ACTIVITY_VALIDATOR, ROLE_VALIDATED_PERFORMER,
  // Review roles
  ROLE_REVIEWER, ROLE_REVIEWED_AGENT,
  // Issuer types
  ISSUER_VALIDATOR, ISSUER_INSURER, ISSUER_AUDITOR, ISSUER_TEE_VERIFIER,
  ISSUER_STAKING_POOL, ISSUER_GOVERNANCE, ISSUER_ORACLE,
  // Validation methods
  VM_SELF_ASSERTED, VM_COUNTERPARTY_CONFIRMED, VM_VALIDATOR_VERIFIED,
  VM_INSURER_ISSUED, VM_TEE_ONCHAIN_VERIFIED, VM_TEE_OFFCHAIN_AGGREGATED,
  VM_ZK_VERIFIED, VM_REPRODUCIBLE_BUILD, VM_GOVERNANCE_APPROVED,
  // Enums
  EdgeStatus, AssertionType, ResolutionMode,
  // Helpers
  roleName, relationshipTypeName, issuerTypeName, validationMethodName,
  getToolsForRoles, getToolsForRoleHashes,
  toDidEthr,
} from './relationship'
export type { RoleTool } from './relationship-taxonomy'
export type {
  RelationshipProtocolConfig,
  OnChainEdge,
  OnChainAssertion,
} from './relationship'

// ─── Predicates (Ontology Constants) ─────────────────────────────────
export {
  RDF_TYPE, ATL_DISPLAY_NAME, ATL_DESCRIPTION, ATL_IS_ACTIVE, ATL_VERSION,
  ATL_AGENT_TYPE, ATL_AI_AGENT_CLASS,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT, TYPE_HUB,
  CLASS_DISCOVERY, CLASS_VALIDATOR, CLASS_EXECUTOR, CLASS_ASSISTANT, CLASS_ORACLE, CLASS_CUSTOM,
  ATL_A2A_ENDPOINT, ATL_MCP_SERVER, ATL_SERVICE_ENDPOINT,
  ATL_SUPPORTED_TRUST, ATL_CAPABILITY,
  ATL_CONTROLLER, ATL_OPERATED_BY,
  ATL_METADATA_URI, ATL_METADATA_HASH, ATL_SCHEMA_URI,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE,
  ATL_HUB_NAV_CONFIG, ATL_HUB_NETWORK_LABEL, ATL_HUB_CONTEXT_TERM,
  ATL_HUB_OVERVIEW_LABEL, ATL_HUB_AGENT_LABEL,
  ATL_HUB_FEATURES, ATL_HUB_THEME, ATL_HUB_VIEW_MODES, ATL_HUB_GREETING,
  ATL_HUB_VOCABULARY, ATL_HUB_ROLE_VOCABULARY, ATL_HUB_TYPE_VOCABULARY,
  ATL_GENMAP_DATA, ATL_ACTIVITY_LOG, ATL_TRACKED_MEMBERS, ATL_TEMPLATE_ID,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  ATL_ENTRY_POINT, ATL_IMPLEMENTATION, ATL_DELEGATION_MANAGER,
  AGENT_TYPE_LABELS, AI_CLASS_LABELS,
} from './predicates'

// ─── Agent Naming (.agent namespace) ─────────────────────────────────
export {
  AGENT_TLD,
  namehash, labelhash, normalize, splitName, buildName,
  resolveName, reverseResolve, listSubnames, getNamePath, getNameTree,
} from './naming'
export type { NameResolutionConfig, NameTreeNode } from './naming'

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

// ─── External bundler + paymaster ────────────────────────────────────
export { BundlerClient, BundlerRpcError } from './bundler'
export type { BundlerConfig, UserOperationReceipt, GasEstimate } from './bundler'
export { PaymasterClient, PaymasterRpcError } from './paymaster'
export type {
  PaymasterConfig,
  PaymasterStubData,
  PaymasterData,
  SponsorUserOperationResponse,
} from './paymaster'
export { UserOperationBuilder } from './user-operation-builder'
export type {
  UserOperationBuilderConfig,
  SendArgs,
  SignUserOpFn,
} from './user-operation-builder'
export type {
  UserOperation,
  UserOperationDraft,
  Hex as UserOpHex,
  Address as UserOpAddress,
} from './bundler-types'

// ─── ERC-6492 counterfactual signatures ──────────────────────────────
export {
  wrap6492,
  unwrap6492,
  is6492Signature,
  ERC6492_MAGIC_SUFFIX,
} from './erc6492'
export type { Unwrapped6492, Unwrapped6492Not } from './erc6492'

// ─── WebAuthn / Passkey helpers ──────────────────────────────────────
export {
  buildPasskeyAssertion,
  encodeAssertionForValidator,
  packWebAuthnSignature,
  parseDerSignature,
  normaliseLowS,
  hashToWebAuthnChallenge,
  base64urlEncode,
  base64urlDecode,
  P256_N,
} from './passkey'
export type { PasskeyAssertion } from './passkey'
