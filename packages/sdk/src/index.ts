// ─── ABIs ────────────────────────────────────────────────────────────
export {
  agentAccountAbi,
  agentAccountFactoryAbi,
  sessionAgentAccountFactoryAbi,
  delegationManagerAbi,
  agentRelationshipAbi,
  agentAssertionAbi,
  classAssertionAbi,
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
  geoFeatureRegistryAbi,
  geoClaimRegistryAbi,
  skillDefinitionRegistryAbi,
  agentSkillRegistryAbi,
  skillIssuerRegistryAbi,
  // Per-registry attribute storage (each registry inherits AttributeStorage)
  shapeRegistryAbi,
  poolRegistryAbi,
  fundRegistryAbi,
  proposalRegistryAbi,
  // Spec 004 marketplace registries
  voteRegistryAbi,
  grantProposalRegistryAbi,
  pledgeRegistryAbi,
  matchInitiationRegistryAbi,
  // Spec 006 universal match fulfillment
  commitmentRegistryAbi,
  agentNameAttributeResolverAbi,
  // Spec 005 — local-dev USDC for personal-treasury honor flow
  mockUsdcAbi,
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
  encodeTaskBindingTerms,
  encodeCallDataHashTerms,
  encodeRateLimitTerms,
  encodeRecoveryTerms,
  encodeRecoveryArgs,
  computeRecoveryIntentHash,
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
  decodeTaskBindingTerms,
  decodeCallDataHashTerms,
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
  // Delegate-binding caveat (Sprint 2 S2.3 — cross-delegation dual-address binding)
  DELEGATE_BINDING_ENFORCER,
  encodeDelegateBindingTerms,
  decodeDelegateBindingTerms,
  buildDelegateBindingCaveat,
  // MCP audience constants (SEC-17)
  PERSON_MCP_AUDIENCE,
  ORG_MCP_AUDIENCE,
  PEOPLE_GROUPS_MCP_AUDIENCE,
} from './delegation'
export type { DataScopeGrant, DelegateBindingTerms } from './delegation'

// ─── Data scope field registry (SEC-18 / ADR-PG-4 forward compat) ───
export {
  DATA_SCOPE_FIELDS_V1,
  resolveDataScopeFields,
} from './data-scope-fields'
export type { DelegationClientConfig } from './delegation'

// ─── Sessions ────────────────────────────────────────────────────────
export { createAgentSession, isSessionValid } from './session'

// ─── Crypto (session encryption, HMAC) ──────────────────────────────
export {
  encryptPayload,
  decryptPayload,
  buildSessionAAD,
  randomHex,
  hmacSign,
  hmacVerify,
  toBase64Url,
  fromBase64Url,
} from './crypto'
export type { EncryptedPayload } from './crypto'

// ─── Key custody (KMS migration K0+K1+K2+K3-ext+K4+K5) ───────────────
// SERVER-ONLY runtime modules are NOT re-exported from this barrel — they
// pull in `node:crypto` and other Node built-ins which webpack cannot bundle
// for client components. Server callers MUST import from the dedicated
// `@smart-agent/sdk/key-custody` subpath. Types are safe to re-export here
// because TypeScript erases them at compile time.
//
// IMPORTANT: re-export from `./key-custody/types` (the pure-type module),
// NOT from `./key-custody` (the runtime barrel). Re-exporting from the
// runtime barrel — even with `export type` — has historically leaked
// `node:crypto` into `apps/web` client bundles (`use-a2a-session.ts`
// regression) because the runtime barrel transitively pulls
// `local-hmac.ts` → `node:crypto`. The `./key-custody/types` module is
// a pure-type re-export hub specifically to keep that edge severed.
//
// ✗ DO NOT add `createLocalHmacProvider`, `createLocalAesProvider`, etc. back
//   to this barrel. They'd break `apps/web` client bundling.
// ✗ DO NOT change the source to `'./key-custody'` — that would re-introduce
//   the regression.
// ✓ Server callers: `import { createLocalAesProvider } from '@smart-agent/sdk/key-custody'`
// ✓ Client callers: only types are available here (and that's intentional).
export type {
  A2AKeyProvider,
  LocalAesProviderEnv,
  AwsKmsEnv,
  AwsKmsDeps,
  // VaultTransit env/deps types were removed when the vault-transit
  // provider was deleted from packages/sdk/src/key-custody/. The selector
  // branch in `buildKeyProvider` / `buildSignerBackend` /
  // `buildToolExecutorBackend` was also removed in G-PR-1
  // (GCP-KMS-IMPLEMENTATION-PLAN.md § G6, orchestrator decision: AWS + GCP
  // only). `A2A_KMS_BACKEND='vault-transit'` now falls into the
  // "unknown backend" branch and fails closed.
  LocalSecp256k1Env,
  LocalSecp256k1Signer,
  KmsAccountBackend,
  CreateKmsAccountOptions,
  AwsKmsSignerEnv,
  AwsKmsSignerDeps,
  AwsKmsSigner,
  ToolExecutorId,
  ToolExecutorSignerBackend,
  ToolExecutorSignerEnv,
  ToolExecutorSignerDeps,
  KmsMacProvider,
  AwsKmsMacEnv,
  AwsKmsMacDeps,
  LocalHmacEnv,
  MacKeyId,
  McpName,
  McpMacProviderEnv,
} from './key-custody/types'

// ─── Session TTL policy (risk-tier-based caps) ───────────────────────
export { MAX_SESSION_TTL_SEC, clampSessionTtl } from './policy/session-ttl'
export type { SessionRiskTier } from './policy/session-ttl'

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
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT, TYPE_HUB, TYPE_TREASURY_AGENT, TYPE_POOL_AGENT,
  CLASS_DISCOVERY, CLASS_VALIDATOR, CLASS_EXECUTOR, CLASS_ASSISTANT, CLASS_ORACLE, CLASS_CUSTOM,
  ATL_A2A_ENDPOINT, ATL_MCP_SERVER, ATL_SERVICE_ENDPOINT,
  ATL_SUPPORTED_TRUST, ATL_CAPABILITY,
  ATL_CONTROLLER, ATL_OPERATED_BY,
  ATL_METADATA_URI, ATL_METADATA_HASH, ATL_SCHEMA_URI,
  ATL_CITY, ATL_REGION, ATL_COUNTRY,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE,
  ATL_HUB_NAV_CONFIG, ATL_HUB_NETWORK_LABEL, ATL_HUB_CONTEXT_TERM,
  ATL_HUB_OVERVIEW_LABEL, ATL_HUB_AGENT_LABEL,
  ATL_HUB_FEATURES, ATL_HUB_THEME, ATL_HUB_VIEW_MODES, ATL_HUB_GREETING,
  ATL_HUB_VOCABULARY, ATL_HUB_ROLE_VOCABULARY, ATL_HUB_TYPE_VOCABULARY,
  ATL_GENMAP_DATA, ATL_ACTIVITY_LOG, ATL_TRACKED_MEMBERS, ATL_TEMPLATE_ID,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  ATL_ENTRY_POINT, ATL_IMPLEMENTATION, ATL_DELEGATION_MANAGER,
  SA_HAS_PERSONAL_TREASURY, SA_HAS_TREASURY,
  AGENT_TYPE_LABELS, AI_CLASS_LABELS,
  // Multi-root namespace + geo
  KIND_AGENT, KIND_GEO, KIND_PEOPLE_GROUP, KIND_SKILL,
  GEO_KIND_PLANET, GEO_KIND_COUNTRY, GEO_KIND_STATE, GEO_KIND_COUNTY,
  GEO_KIND_MUNICIPALITY, GEO_KIND_NEIGHBORHOOD, GEO_KIND_ZIPCODE, GEO_KIND_CUSTOM,
  GEO_REL_SERVES_WITHIN, GEO_REL_OPERATES_IN, GEO_REL_LICENSED_IN,
  GEO_REL_COMPLETED_TASK_IN, GEO_REL_VALIDATED_PRESENCE_IN, GEO_REL_STEWARD_OF,
  GEO_REL_RESIDENT_OF, GEO_REL_ORIGIN_IN,
  GEO_VISIBILITY,
  // Skills
  SKILL_KIND_OASF_LEAF, SKILL_KIND_DOMAIN, SKILL_KIND_CUSTOM,
  SKILL_REL_HAS_SKILL, SKILL_REL_PRACTICES_SKILL, SKILL_REL_CERTIFIED_IN,
  SKILL_REL_ENDORSES_SKILL, SKILL_REL_MENTORS_IN, SKILL_REL_CAN_TRAIN_OTHERS,
  SKILL_REL_HASH_TO_LABEL,
  SKILL_VISIBILITY,
  SKILL_PROFICIENCY_LABEL,
  SKILL_OVERLAP_POLICY_ID,
  SKILL_SELF_MAX_PROFICIENCY,
  skillProficiencyLabel,
  namehashRoot,
} from './predicates'
export type { GeoVisibility, SkillVisibility, SkillProficiencyLabel } from './predicates'

// ─── Treasury Resolution (spec-006) ──────────────────────────────────
export { resolveRecipientTreasury } from './treasury'
export type { PrincipalToAgentResolver, ResolveRecipientContext } from './treasury'

// ─── Agent Naming (.agent namespace) ─────────────────────────────────
export {
  AGENT_TLD,
  namehash, labelhash, normalize, splitName, buildName,
  resolveName, reverseResolve, listSubnames, getNamePath, getNameTree,
} from './naming'
export type { NameResolutionConfig, NameTreeNode } from './naming'

// ─── Geo (.geo namespace) ────────────────────────────────────────────
export { GeoFeatureClient, GEO_FEATURE_KIND_HASHES, GEO_COORD_SCALE } from './geo-feature'
export type { GeoFeatureRecord, PublishFeatureInput, GeoFeatureKindLabel } from './geo-feature'
export { GeoClaimClient } from './geo-claim'
export type { GeoClaimRecord, MintClaimInput, GeoRelation, GeoVisibilityLabel } from './geo-claim'

// ─── Skills (mirrors geo) ────────────────────────────────────────────
export { SkillDefinitionClient } from './skill-definition'
export type { SkillRecord, PublishSkillInput, SkillKindLabel } from './skill-definition'
export { AgentSkillClient } from './skill-claim'
export type { SkillClaim, MintInput as SkillMintInput, SkillRelationLabel } from './skill-claim'
export { SkillIssuerClient, ANY_SKILL as SKILL_ISSUER_ANY_SKILL } from './skill-issuer'
export type { IssuerProfile as SkillIssuerProfile, RegisterIssuerInput as RegisterSkillIssuerInput } from './skill-issuer'
export { canonicalSkillName, canonicalizeLabel, namehashOfSkillFqn } from './skill-name-canon'
export type { CanonicalSkillName } from './skill-name-canon'

// ─── Credential kinds (AnonCreds) ────────────────────────────────────
export { CREDENTIAL_KINDS, findCredentialKind } from './credential-types'
export type { CredentialKindDescriptor, IssuerKey } from './credential-types'

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
export { parseAttestationObject, parseAuthData } from './cose-parse'
export type { ParsedAttestation } from './cose-parse'

// ─── Matchmaker (intent-marketplace ranking) ─────────────────────────
export {
  computeBasis,
  rank,
  rankCue,
  DEFAULT_RANK_WEIGHTS,
  RANK_TIE_TOLERANCE,
  proposerSideSignals,
  stewardSideSignals,
} from './matchmaker'
export type {
  RankBasis,
  RankableSignals,
  Rankable,
  Ranked,
  ProposerSideInput,
  ProposerSideSignals,
  StewardSideInput,
  StewardSideSignals,
  SideSignalsDiscovery,
} from './matchmaker'

// ─── Class-assertion emit (relayed on-chain anchoring) ──────────────
export {
  emitClassAssertion,
  iriToBytes32,
  defaultPayloadURI,
} from './class-assertion-emit'
export type {
  ClassAssertionEmitConfig,
  ClassAssertionEmitInput,
  ClassAssertionEmitResult,
} from './class-assertion-emit'

// ─── Marketplace delegation scopes ───────────────────────────────────
export {
  MARKETPLACE_SCOPES,
  SPEC_001_SCOPES,
  SPEC_002_SCOPES,
  SPEC_003_SCOPES,
  findScope,
  isMarketplaceScope,
  scopesOfKind,
  scopesForSpec,
} from './marketplace-scopes'
export type {
  ScopeKind,
  ScopeDescriptor,
  MarketplaceScopeKey,
  MarketplaceScopeString,
} from './marketplace-scopes'

// ─── Rounds (spec 003 — Intent Marketplace, Proposal Lane) ──────────
export { RoundClient } from './rounds'
export type {
  IRoundClient,
  RoundDiscoveryReader,
  Round,
  RoundListItem,
  RoundListFilters,
  RoundMandate,
  RoundMilestoneTemplate,
  RoundValidatorRequirements,
  RoundPriorStats,
  ReportingCadence,
} from './rounds'

// ─── Match Initiations (spec 001 — Intent Marketplace, Direct Lane) ──
export { MatchInitiationClient } from './matchInitiations'
export type {
  IMatchInitiationClient,
  MatchInitiation,
  MatchInitiationKind,
  MatchInitiationStatus,
  MatchInitiationVisibility,
  ProposeMatchRequest,
  ProposeMatchError,
  ProposeMatchResult,
} from './matchInitiations'

// ─── Grant Proposals (spec 003 — Intent Marketplace, Proposal Lane) ──
export { GrantProposalClient } from './grantProposals'
export type {
  IGrantProposalClient,
  McpInvoker,
  McpTarget,
  GrantProposal,
  GrantProposalStatus,
  Budget,
  BudgetLineItem,
  Milestone,
  DesiredOutcome,
  ReportingObligations,
  OrganisationalBackground,
  SubmitGrantProposalRequest,
  EditGrantProposalRequest,
  SubmitGrantProposalError,
  SubmitGrantProposalResult,
  WithdrawGrantProposalResult,
} from './grantProposals'

// ─── Pools (spec 002 — Intent Marketplace, Pool Lane) ────────────────
export { PoolClient } from './pools'
export type {
  IPoolClient,
  PoolDiscoveryReader,
  Pool,
  Fund,
  PoolListItem,
  PoolListFilters,
  PoolDomain,
  PoolGovernanceModel,
  AcceptedRestrictions,
  CeilingPolicy,
  PoolAllocationSummary,
} from './pools'

// ─── Pool Pledges (spec 002 — Intent Marketplace, Pool Lane) ─────────
export { PoolPledgeClient, cadenceAwareTotal } from './poolPledges'
export type {
  IPoolPledgeClient,
  PoolPledge,
  PledgeCadence,
  PledgeStoryPermission,
  PledgeStatus,
  PledgeRestrictions,
  PledgeAmendment,
  PledgeAmendmentKind,
  PledgeVisibility,
  SubmitPledgeRequest,
  SubmitPledgeResult,
  SubmitPledgeError,
  AmendPledgeRequest,
} from './poolPledges'

// ─── On-chain attribute store helpers (Phase 0) ──────────────────────
export {
  agentSubject,
  nameSubject,
  roundSubject,
  proposalSubject,
  matchSubject,
  pledgeSubject,
  subjectId,
  predicateId,
  DT,
} from './onchain/attributes/subject'
export type { SubjectDomain, Datatype } from './onchain/attributes/subject'

export { PoolRegistryClient, normalizeGovernance } from './onchain/attributes/poolRegistry'
export type {
  OpenPoolInput,
  PoolRegistryClientConfig,
  PoolGovernanceModel as OnChainPoolGovernanceModel,
  PoolCeilingPolicy as OnChainPoolCeilingPolicy,
  PoolVisibility as OnChainPoolVisibility,
} from './onchain/attributes/poolRegistry'

export { FundRegistryClient, roundSubjectFor } from './onchain/attributes/fundRegistry'
export type {
  OpenRoundInput as OnChainOpenRoundInput,
  FundRegistryClientConfig,
  RoundStatus,
  RoundVisibility,
} from './onchain/attributes/fundRegistry'

// ─── Caveat evaluator (off-chain twin of on-chain enforcers) ─────────
export {
  evaluateCaveats,
  firstDenial,
} from './policy/caveat-evaluator'
export type {
  CaveatContext,
  CaveatVerdict,
  CaveatLike,
  EnforcerAddressMap,
} from './policy/caveat-evaluator'

// ─── ToolPolicyRegistry (Phase 0 — delegation architecture) ──────────
export {
  TOOL_POLICIES,
  POOL_REGISTRY_SELECTORS_BY_TOOL,
  FUND_REGISTRY_SELECTORS_BY_TOOL,
  AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL,
  AGENT_RELATIONSHIP_SELECTORS_BY_TOOL,
  PROPOSAL_REGISTRY_SELECTORS_BY_TOOL,
  COMMITMENT_REGISTRY_SELECTORS_BY_TOOL,
  getToolPolicy,
  isOnchainTool,
  isSensitiveTool,
  listOnchainToolIds,
  listAllowedTargetSymbols,
  listAllowedFunctionNames,
  resolveTargetAddress,
} from './policy/tool-policies'
export type {
  ToolPolicy,
  RiskTier,
  ExecutionPath,
} from './policy/tool-policies'

// ─── Audit (Phase 0 — delegation architecture) ───────────────────────
export type {
  ExecutionReceipt,
  ExecutionReceiptSummary,
  ExecutionPathKind,
  ExecutionStatus,
} from './audit/types'

// ─── Permissions (Phase 4 — wallet permission interop) ───────────────
export type {
  SessionPermissionRequest,
  PermissionPreview,
} from './permissions/types'
export { previewSessionRequest } from './permissions/types'
export { buildSessionPermissionRequest } from './permissions/build'
export type { BuildSessionPermissionRequestInput } from './permissions/build'

// Spec 004 — AnonCreds-gated marketplace auth nullifier helpers.
export {
  computeNullifier,
  voteContext,
  proposalContext,
} from './anoncreds/nullifier'
export type { NullifierContext } from './anoncreds/nullifier'

// Spec 004 — On-chain marketplace registry clients.
export {
  VoteRegistryClient,
  GrantProposalRegistryClient,
  PledgeRegistryClient,
  MatchInitiationRegistryClient,
} from './onchain/marketplace'
export type {
  Ballot,
  Cadence,
  InitiationKind,
  MatchVisibility,
  CastVoteInput,
  SubmitGrantProposalInput,
  EditGrantProposalInput,
  SubmitPledgeInput,
  CreateMatchInitiationInput,
} from './onchain/marketplace'

// Spec 004 (b2) — Admin → holder → session delegation chain helpers.
export {
  SPEC004_SELECTORS,
  buildAdminDelegationCaveats,
  signRootDelegation,
  signChildDelegation,
  delegationHash,
} from './onchain/marketplace/admin-delegation'
export type {
  AdminDelegationScope,
  SignedDelegation as Spec004SignedDelegation,
} from './onchain/marketplace/admin-delegation'

// Spec 005 — Personal-treasury honor + admin mark-paid helpers.
export {
  SPEC005_SELECTORS,
  paymentRailConcept,
  encodeHonorBatch,
  honorBatchHash,
  encodeMarkPaid,
  markPaidHash,
  buildHonorDelegationCaveats,
  buildMarkPaidDelegationCaveats,
  // Spec 006 — release rail
  encodeReleaseBatch,
  releaseBatchHash,
  buildReleaseDelegationCaveats,
} from './onchain/marketplace/treasury'
export type {
  PaymentRail,
  HonorBatchInput,
  MarkPaidInput,
  HonorDelegationCaveatScope,
  MarkPaidDelegationCaveatScope,
  ReleaseBatchInput,
  ReleaseDelegationCaveatScope,
} from './onchain/marketplace/treasury'
