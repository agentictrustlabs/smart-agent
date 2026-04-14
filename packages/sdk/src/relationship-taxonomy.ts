import { keccak256, toBytes } from 'viem'

export type TaxonomyHubId = 'generic' | 'global-church' | 'catalyst' | 'cil'

export interface RelationshipTypeDefinition {
  key: string
  term: string
  label: string
  description: string
  parentTerm?: string
  hubLabels?: Partial<Record<TaxonomyHubId, string>>
}

export interface RoleDefinition {
  key: string
  term: string
  label: string
  description: string
  relationshipTypeKeys: string[]
  parentTerm?: string
  hubLabels?: Partial<Record<TaxonomyHubId, string>>
  delegationPolicyKey?: string
  inviteAliases?: string[]
}

export type DelegationEnforcerKey = 'timestamp' | 'value' | 'allowedTargets' | 'allowedMethods'

export interface DelegationPolicyDefinition {
  key: string
  relationshipTypeKey: string
  roleKey: string
  templateName: string
  templateDescription: string
  defaultDurationSeconds?: number
  requiredEnforcers: DelegationEnforcerKey[]
  optionalEnforcers?: DelegationEnforcerKey[]
  allowedTargetEnvKey?: string
  allowedMethodSelectors?: `0x${string}`[]
}

function withHash<T extends { term: string }>(entry: T): T & { hash: `0x${string}` } {
  return {
    ...entry,
    hash: keccak256(toBytes(entry.term)),
  }
}

export function hashTaxonomyTerm(term: string): `0x${string}` {
  return keccak256(toBytes(term))
}

const relationshipTypeDefinitions: Array<RelationshipTypeDefinition & { hash: `0x${string}` }> = [
  withHash({
    key: 'organization-governance',
    term: 'atl:OrganizationGovernanceRelationship',
    label: 'Governance',
    description: 'Governance, fiduciary, and executive authority between an agent and an organization.',
    parentTerm: 'atl:InstitutionalRelationship',
  }),
  withHash({
    key: 'organization-membership',
    term: 'atl:OrganizationMembershipRelationship',
    label: 'Membership',
    description: 'Membership, staffing, or operating participation within an organization or group.',
    parentTerm: 'atl:InstitutionalRelationship',
  }),
  withHash({
    key: 'alliance',
    term: 'atl:AllianceRelationship',
    label: 'Alliance',
    description: 'Strategic alignment or generative linkage between organizations, groups, or networks.',
    parentTerm: 'atl:NetworkRelationship',
    hubLabels: {
      catalyst: 'Lineage Link',
      'global-church': 'Ministry Link',
      cil: 'Trust Link',
    },
  }),
  withHash({
    key: 'validation-trust',
    term: 'atl:ValidationTrustRelationship',
    label: 'Validation',
    description: 'A trust-bearing relationship used for validation, assurance, or verification.',
    parentTerm: 'atl:AssuranceRelationship',
  }),
  withHash({
    key: 'insurance-coverage',
    term: 'atl:InsuranceCoverageRelationship',
    label: 'Insurance',
    description: 'Coverage or underwriting relationship providing risk protection.',
    parentTerm: 'atl:AssuranceRelationship',
  }),
  withHash({
    key: 'compliance',
    term: 'atl:ComplianceRelationship',
    label: 'Compliance',
    description: 'Regulatory or standards compliance relationship.',
    parentTerm: 'atl:AssuranceRelationship',
  }),
  withHash({
    key: 'economic-security',
    term: 'atl:EconomicSecurityRelationship',
    label: 'Economic Security',
    description: 'Capital backing, staking, guarantee, or other economic security relationship.',
    parentTerm: 'atl:CapitalRelationship',
  }),
  withHash({
    key: 'service-agreement',
    term: 'atl:ServiceAgreementRelationship',
    label: 'Service',
    description: 'Service-delivery relationship between an operator and a target organization.',
    parentTerm: 'atl:ExecutionRelationship',
  }),
  withHash({
    key: 'delegation-authority',
    term: 'atl:DelegationAuthorityRelationship',
    label: 'Delegation',
    description: 'Relationship used to derive executable delegated authority.',
    parentTerm: 'atl:ExecutionRelationship',
  }),
  withHash({
    key: 'runtime-attestation',
    term: 'atl:RuntimeAttestationRelationship',
    label: 'Runtime/TEE',
    description: 'Relationship binding an agent or runtime to attestation evidence.',
    parentTerm: 'atl:InfrastructureRelationship',
  }),
  withHash({
    key: 'build-provenance',
    term: 'atl:BuildProvenanceRelationship',
    label: 'Build Provenance',
    description: 'Relationship linking deployed artifacts to build origin or software provenance.',
    parentTerm: 'atl:InfrastructureRelationship',
  }),
  withHash({
    key: 'organizational-control',
    term: 'atl:OrganizationalControlRelationship',
    label: 'Org Control',
    description: 'Relationship used when an organization operates or manages an agent.',
    parentTerm: 'atl:ExecutionRelationship',
  }),
  withHash({
    key: 'activity-validation',
    term: 'atl:ActivityValidationRelationship',
    label: 'Activity Validation',
    description: 'Relationship validating real-world activity, service delivery, or field work.',
    parentTerm: 'atl:AssuranceRelationship',
  }),
  withHash({
    key: 'review',
    term: 'atl:ReviewRelationship',
    label: 'Review',
    description: 'Relationship authorizing one agent to evaluate or review another.',
    parentTerm: 'atl:AssuranceRelationship',
    hubLabels: {
      'global-church': 'Endorsement',
      cil: 'Assertion',
    },
  }),
  withHash({
    key: 'has-member',
    term: 'atl:HasMemberRelationship',
    label: 'Hub Membership',
    description: 'Membership of an agent within a portal, cohort, hub, or network context.',
    parentTerm: 'atl:NetworkRelationship',
  }),
] 

const roleDefinitions: Array<RoleDefinition & { hash: `0x${string}` }> = [
  withHash({
    key: 'owner',
    term: 'atl:OwnerRole',
    label: 'owner',
    description: 'Primary governing authority for an organization or agent.',
    relationshipTypeKeys: ['organization-governance'],
    parentTerm: 'atl:GovernanceRole',
    inviteAliases: ['owner'],
  }),
  withHash({
    key: 'board-member',
    term: 'atl:BoardMemberRole',
    label: 'board-member',
    description: 'Member of the governing board.',
    relationshipTypeKeys: ['organization-governance'],
    parentTerm: 'atl:GovernanceRole',
  }),
  withHash({
    key: 'ceo',
    term: 'atl:ChiefExecutiveRole',
    label: 'ceo',
    description: 'Chief executive responsible for organizational leadership.',
    relationshipTypeKeys: ['organization-governance'],
    parentTerm: 'atl:GovernanceRole',
    delegationPolicyKey: 'ceo-treasury',
    inviteAliases: ['ceo'],
  }),
  withHash({
    key: 'executive',
    term: 'atl:ExecutiveRole',
    label: 'executive',
    description: 'Executive leadership role.',
    relationshipTypeKeys: ['organization-governance'],
    parentTerm: 'atl:GovernanceRole',
  }),
  withHash({
    key: 'treasurer',
    term: 'atl:TreasurerRole',
    label: 'treasurer',
    description: 'Role with treasury or financial oversight responsibilities.',
    relationshipTypeKeys: ['organization-governance', 'organization-membership'],
    parentTerm: 'atl:GovernanceRole',
    inviteAliases: ['treasurer'],
  }),
  withHash({
    key: 'authorized-signer',
    term: 'atl:AuthorizedSignerRole',
    label: 'authorized-signer',
    description: 'Role allowed to sign or approve bounded transactions.',
    relationshipTypeKeys: ['organization-governance', 'organization-membership', 'delegation-authority'],
    parentTerm: 'atl:GovernanceRole',
    inviteAliases: ['authorized-signer'],
  }),
  withHash({
    key: 'officer',
    term: 'atl:OfficerRole',
    label: 'officer',
    description: 'Institutional officer role.',
    relationshipTypeKeys: ['organization-governance'],
    parentTerm: 'atl:GovernanceRole',
  }),
  withHash({
    key: 'chair',
    term: 'atl:ChairRole',
    label: 'chair',
    description: 'Chair of a governing body or committee.',
    relationshipTypeKeys: ['organization-governance'],
    parentTerm: 'atl:GovernanceRole',
  }),
  withHash({
    key: 'advisor',
    term: 'atl:AdvisorRole',
    label: 'advisor',
    description: 'Advisory role contributing guidance rather than direct control.',
    relationshipTypeKeys: ['organization-governance', 'organization-membership'],
    parentTerm: 'atl:AdvisoryRole',
  }),
  withHash({
    key: 'admin',
    term: 'atl:AdministratorRole',
    label: 'admin',
    description: 'Administrative role inside an organization or group.',
    relationshipTypeKeys: ['organization-membership'],
    parentTerm: 'atl:MembershipRole',
    inviteAliases: ['admin'],
  }),
  withHash({
    key: 'member',
    term: 'atl:MemberRole',
    label: 'member',
    description: 'General member participating in an organization or cohort.',
    relationshipTypeKeys: ['organization-membership', 'has-member'],
    parentTerm: 'atl:MembershipRole',
    inviteAliases: ['member'],
  }),
  withHash({
    key: 'operator',
    term: 'atl:OperatorRole',
    label: 'operator',
    description: 'Operational role responsible for carrying out work.',
    relationshipTypeKeys: ['organization-membership'],
    parentTerm: 'atl:MembershipRole',
    delegationPolicyKey: 'operator-execution',
  }),
  withHash({
    key: 'employee',
    term: 'atl:EmployeeRole',
    label: 'employee',
    description: 'Employee participating in ongoing organizational work.',
    relationshipTypeKeys: ['organization-membership'],
    parentTerm: 'atl:MembershipRole',
  }),
  withHash({
    key: 'contractor',
    term: 'atl:ContractorRole',
    label: 'contractor',
    description: 'External contractor with a bounded service role.',
    relationshipTypeKeys: ['service-agreement'],
    parentTerm: 'atl:ServiceRole',
  }),
  withHash({
    key: 'auditor',
    term: 'atl:AuditorRole',
    label: 'auditor',
    description: 'Auditor providing review, inspection, or assurance.',
    relationshipTypeKeys: ['organization-membership', 'review', 'compliance'],
    parentTerm: 'atl:AssuranceRole',
    delegationPolicyKey: 'auditor-read',
  }),
  withHash({
    key: 'validator',
    term: 'atl:ValidatorRole',
    label: 'validator',
    description: 'Validator confirming evidence, trust, or compliance.',
    relationshipTypeKeys: ['organization-membership', 'validation-trust', 'activity-validation'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'insurer',
    term: 'atl:InsurerRole',
    label: 'insurer',
    description: 'Coverage provider or insurer.',
    relationshipTypeKeys: ['insurance-coverage'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'insured-party',
    term: 'atl:InsuredPartyRole',
    label: 'insured-party',
    description: 'Covered or protected party in an insurance relationship.',
    relationshipTypeKeys: ['insurance-coverage'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'underwriter',
    term: 'atl:UnderwriterRole',
    label: 'underwriter',
    description: 'Underwriter role assessing and backing risk.',
    relationshipTypeKeys: ['insurance-coverage'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'certified-by',
    term: 'atl:CertifiedByRole',
    label: 'certified-by',
    description: 'Role indicating the subject is certified by the object.',
    relationshipTypeKeys: ['validation-trust', 'compliance'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'licensed-by',
    term: 'atl:LicensedByRole',
    label: 'licensed-by',
    description: 'Role indicating the subject is licensed by the object.',
    relationshipTypeKeys: ['compliance'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'staker',
    term: 'atl:StakerRole',
    label: 'staker',
    description: 'Role providing economic stake or bonded capital.',
    relationshipTypeKeys: ['economic-security'],
    parentTerm: 'atl:EconomicRole',
    delegationPolicyKey: 'staker-bond',
  }),
  withHash({
    key: 'guarantor',
    term: 'atl:GuarantorRole',
    label: 'guarantor',
    description: 'Role guaranteeing obligations or outcomes.',
    relationshipTypeKeys: ['economic-security'],
    parentTerm: 'atl:EconomicRole',
  }),
  withHash({
    key: 'backer',
    term: 'atl:BackerRole',
    label: 'backer',
    description: 'Capital backer or financial supporter.',
    relationshipTypeKeys: ['economic-security'],
    parentTerm: 'atl:EconomicRole',
  }),
  withHash({
    key: 'collateral-provider',
    term: 'atl:CollateralProviderRole',
    label: 'collateral-provider',
    description: 'Provider of collateral or economic coverage.',
    relationshipTypeKeys: ['economic-security'],
    parentTerm: 'atl:EconomicRole',
  }),
  withHash({
    key: 'strategic-partner',
    term: 'atl:StrategicPartnerRole',
    label: 'strategic-partner',
    description: 'Role linking organizations as strategic partners or lineage peers.',
    relationshipTypeKeys: ['alliance'],
    parentTerm: 'atl:AllianceRole',
    hubLabels: {
      catalyst: 'parent-circle',
    },
  }),
  withHash({
    key: 'affiliate',
    term: 'atl:AffiliateRole',
    label: 'affiliate',
    description: 'Affiliate role within a partnership or network.',
    relationshipTypeKeys: ['alliance'],
    parentTerm: 'atl:AllianceRole',
  }),
  withHash({
    key: 'endorsed-by',
    term: 'atl:EndorsedByRole',
    label: 'endorsed-by',
    description: 'Role indicating endorsement by a counterparty.',
    relationshipTypeKeys: ['alliance', 'review'],
    parentTerm: 'atl:AllianceRole',
  }),
  withHash({
    key: 'subsidiary',
    term: 'atl:SubsidiaryRole',
    label: 'subsidiary',
    description: 'Subsidiary organizational role.',
    relationshipTypeKeys: ['alliance'],
    parentTerm: 'atl:AllianceRole',
  }),
  withHash({
    key: 'parent-org',
    term: 'atl:ParentOrganizationRole',
    label: 'parent-org',
    description: 'Parent organization role.',
    relationshipTypeKeys: ['alliance'],
    parentTerm: 'atl:AllianceRole',
  }),
  withHash({
    key: 'vendor',
    term: 'atl:VendorRole',
    label: 'vendor',
    description: 'Vendor role in a service relationship.',
    relationshipTypeKeys: ['service-agreement'],
    parentTerm: 'atl:ServiceRole',
  }),
  withHash({
    key: 'service-provider',
    term: 'atl:ServiceProviderRole',
    label: 'service-provider',
    description: 'Service provider role with bounded execution authority.',
    relationshipTypeKeys: ['service-agreement'],
    parentTerm: 'atl:ServiceRole',
    delegationPolicyKey: 'service-provider-execution',
  }),
  withHash({
    key: 'delegated-operator',
    term: 'atl:DelegatedOperatorRole',
    label: 'delegated-operator',
    description: 'Operator role derived from a delegation authority relationship.',
    relationshipTypeKeys: ['delegation-authority'],
    parentTerm: 'atl:ExecutionRole',
  }),
  withHash({
    key: 'runs-in-tee',
    term: 'atl:RunsInTEERole',
    label: 'runs-in-tee',
    description: 'Role asserting runtime execution inside a TEE.',
    relationshipTypeKeys: ['runtime-attestation'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'attested-by',
    term: 'atl:AttestedByRole',
    label: 'attested-by',
    description: 'Role indicating attestation by a counterparty.',
    relationshipTypeKeys: ['runtime-attestation'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'verified-by',
    term: 'atl:VerifiedByRole',
    label: 'verified-by',
    description: 'Role indicating verification by a counterparty.',
    relationshipTypeKeys: ['runtime-attestation', 'build-provenance'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'bound-to-kms',
    term: 'atl:BoundToKMSRole',
    label: 'bound-to-kms',
    description: 'Role indicating runtime binding to a key-management system.',
    relationshipTypeKeys: ['runtime-attestation'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'controls-runtime',
    term: 'atl:ControlsRuntimeRole',
    label: 'controls-runtime',
    description: 'Role indicating control over runtime execution.',
    relationshipTypeKeys: ['runtime-attestation'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'built-from',
    term: 'atl:BuiltFromRole',
    label: 'built-from',
    description: 'Role linking an artifact to the build that produced it.',
    relationshipTypeKeys: ['build-provenance'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'deployed-from',
    term: 'atl:DeployedFromRole',
    label: 'deployed-from',
    description: 'Role linking deployment back to its source artifact.',
    relationshipTypeKeys: ['build-provenance'],
    parentTerm: 'atl:InfrastructureRole',
  }),
  withHash({
    key: 'operated-agent',
    term: 'atl:OperatedAgentRole',
    label: 'operated-agent',
    description: 'Role indicating an agent is operated by the counterparty organization.',
    relationshipTypeKeys: ['organizational-control'],
    parentTerm: 'atl:ExecutionRole',
  }),
  withHash({
    key: 'managed-agent',
    term: 'atl:ManagedAgentRole',
    label: 'managed-agent',
    description: 'Role indicating an agent is managed by the counterparty organization.',
    relationshipTypeKeys: ['organizational-control'],
    parentTerm: 'atl:ExecutionRole',
  }),
  withHash({
    key: 'administers',
    term: 'atl:AdministersRole',
    label: 'administers',
    description: 'Administrative role over another agent or program.',
    relationshipTypeKeys: ['organizational-control'],
    parentTerm: 'atl:ExecutionRole',
  }),
  withHash({
    key: 'activity-validator',
    term: 'atl:ActivityValidatorRole',
    label: 'activity-validator',
    description: 'Role validating performed field or operational activity.',
    relationshipTypeKeys: ['activity-validation'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'validated-performer',
    term: 'atl:ValidatedPerformerRole',
    label: 'validated-performer',
    description: 'Role indicating the subject performs activity that is validated by the object.',
    relationshipTypeKeys: ['activity-validation'],
    parentTerm: 'atl:AssuranceRole',
  }),
  withHash({
    key: 'reviewer',
    term: 'atl:ReviewerRole',
    label: 'reviewer',
    description: 'Role authorizing the subject to submit reviews about the object.',
    relationshipTypeKeys: ['review'],
    parentTerm: 'atl:AssuranceRole',
    delegationPolicyKey: 'review-submission',
  }),
  withHash({
    key: 'reviewed-agent',
    term: 'atl:ReviewedAgentRole',
    label: 'reviewed-agent',
    description: 'Role indicating the subject is the reviewed party.',
    relationshipTypeKeys: ['review'],
    parentTerm: 'atl:AssuranceRole',
  }),
] 

const delegationPolicyDefinitions: DelegationPolicyDefinition[] = [
  {
    key: 'ceo-treasury',
    relationshipTypeKey: 'organization-governance',
    roleKey: 'ceo',
    templateName: 'CEO Treasury Authority',
    templateDescription: 'Chief executives may execute treasury operations with time and value bounds.',
    requiredEnforcers: ['timestamp', 'value'],
    optionalEnforcers: ['allowedTargets'],
  },
  {
    key: 'operator-execution',
    relationshipTypeKey: 'organization-membership',
    roleKey: 'operator',
    templateName: 'Operator Execution Authority',
    templateDescription: 'Operators may execute approved methods on approved targets with value limits.',
    requiredEnforcers: ['timestamp', 'value', 'allowedTargets', 'allowedMethods'],
  },
  {
    key: 'auditor-read',
    relationshipTypeKey: 'organization-membership',
    roleKey: 'auditor',
    templateName: 'Auditor Read-Only Access',
    templateDescription: 'Auditors may call bounded read paths with time limits.',
    requiredEnforcers: ['timestamp', 'allowedMethods'],
  },
  {
    key: 'staker-bond',
    relationshipTypeKey: 'economic-security',
    roleKey: 'staker',
    templateName: 'Staker Economic Bond',
    templateDescription: 'Stakers have bonded authority constrained by time and optional value bounds.',
    requiredEnforcers: ['timestamp'],
    optionalEnforcers: ['value'],
  },
  {
    key: 'service-provider-execution',
    relationshipTypeKey: 'service-agreement',
    roleKey: 'service-provider',
    templateName: 'Service Provider Execution',
    templateDescription: 'Service providers may call bounded service targets with time and value limits.',
    requiredEnforcers: ['timestamp', 'value', 'allowedTargets'],
  },
  {
    key: 'review-submission',
    relationshipTypeKey: 'review',
    roleKey: 'reviewer',
    templateName: 'Reviewer Access',
    templateDescription: 'Reviewers may submit structured reviews through delegated execution.',
    defaultDurationSeconds: 7 * 24 * 60 * 60,
    requiredEnforcers: ['timestamp', 'allowedMethods', 'allowedTargets'],
    allowedTargetEnvKey: 'AGENT_REVIEW_ADDRESS',
    allowedMethodSelectors: ['0x7e653da2'],
  },
] 

const relationshipTypesByKey = new Map(relationshipTypeDefinitions.map((entry) => [entry.key, entry]))
const relationshipTypesByHash = new Map(relationshipTypeDefinitions.map((entry) => [entry.hash.toLowerCase(), entry]))
const rolesByKey = new Map(roleDefinitions.map((entry) => [entry.key, entry]))
const rolesByHash = new Map(roleDefinitions.map((entry) => [entry.hash.toLowerCase(), entry]))
const policiesByKey = new Map(delegationPolicyDefinitions.map((entry) => [entry.key, entry]))

export const RELATIONSHIP_TYPE_DEFINITIONS = relationshipTypeDefinitions
export const ROLE_DEFINITIONS = roleDefinitions
export const DELEGATION_POLICY_DEFINITIONS = delegationPolicyDefinitions

export function listRelationshipTypeDefinitions() {
  return [...relationshipTypeDefinitions]
}

export function listRoleDefinitions() {
  return [...roleDefinitions]
}

export function getRelationshipTypeDefinitionByKey(key: string) {
  return relationshipTypesByKey.get(key)
}

export function getRelationshipTypeDefinitionByHash(hash: `0x${string}` | string) {
  return relationshipTypesByHash.get(hash.toLowerCase())
}

export function getRoleDefinitionByKey(key: string) {
  return rolesByKey.get(key)
}

export function getRoleDefinitionByHash(hash: `0x${string}` | string) {
  return rolesByHash.get(hash.toLowerCase())
}

export function getDelegationPolicyDefinitionByKey(key: string) {
  return policiesByKey.get(key)
}

export function getDelegationPolicyDefinitionForTerms(
  relationshipType: `0x${string}` | string,
  role: `0x${string}` | string,
) {
  const rel = getRelationshipTypeDefinitionByHash(relationshipType)
  const roleDef = getRoleDefinitionByHash(role)
  if (!rel || !roleDef?.delegationPolicyKey) return null
  return policiesByKey.get(roleDef.delegationPolicyKey) ?? null
}

export function listRoleDefinitionsForRelationshipType(
  relationshipType: `0x${string}` | string,
) {
  const rel = relationshipTypesByHash.get(relationshipType.toLowerCase())
  if (!rel) return []
  return roleDefinitions.filter((role) => role.relationshipTypeKeys.includes(rel.key))
}

export function relationshipTypeName(
  hash: `0x${string}`,
  vocabulary?: Record<string, string>,
  hubId?: TaxonomyHubId,
): string {
  if (vocabulary?.[hash]) return vocabulary[hash]
  const entry = getRelationshipTypeDefinitionByHash(hash)
  if (!entry) return `custom(${hash.slice(0, 10)})`
  return (hubId && entry.hubLabels?.[hubId]) || entry.label
}

export function roleName(
  hash: `0x${string}`,
  vocabulary?: Record<string, string>,
  hubId?: TaxonomyHubId,
): string {
  if (vocabulary?.[hash]) return vocabulary[hash]
  const entry = getRoleDefinitionByHash(hash)
  if (!entry) return `custom(${hash.slice(0, 10)})`
  return (hubId && entry.hubLabels?.[hubId]) || entry.label
}

export function getInviteRoleDefinition(inviteRole: string) {
  return roleDefinitions.find((role) => role.inviteAliases?.includes(inviteRole)) ?? null
}

function requireRelationshipTypeHash(key: string): `0x${string}` {
  const entry = getRelationshipTypeDefinitionByKey(key)
  if (!entry) throw new Error(`Unknown relationship type key: ${key}`)
  return entry.hash
}

function requireRoleHash(key: string): `0x${string}` {
  const entry = getRoleDefinitionByKey(key)
  if (!entry) throw new Error(`Unknown role key: ${key}`)
  return entry.hash
}

export const ORGANIZATION_GOVERNANCE = requireRelationshipTypeHash('organization-governance')
export const ORGANIZATION_MEMBERSHIP = requireRelationshipTypeHash('organization-membership')
export const ALLIANCE = requireRelationshipTypeHash('alliance')
export const VALIDATION_TRUST = requireRelationshipTypeHash('validation-trust')
export const INSURANCE_COVERAGE = requireRelationshipTypeHash('insurance-coverage')
export const COMPLIANCE = requireRelationshipTypeHash('compliance')
export const ECONOMIC_SECURITY = requireRelationshipTypeHash('economic-security')
export const SERVICE_AGREEMENT = requireRelationshipTypeHash('service-agreement')
export const DELEGATION_AUTHORITY = requireRelationshipTypeHash('delegation-authority')
export const RUNTIME_ATTESTATION = requireRelationshipTypeHash('runtime-attestation')
export const BUILD_PROVENANCE = requireRelationshipTypeHash('build-provenance')
export const ORGANIZATIONAL_CONTROL = requireRelationshipTypeHash('organizational-control')
export const ACTIVITY_VALIDATION = requireRelationshipTypeHash('activity-validation')
export const REVIEW_RELATIONSHIP = requireRelationshipTypeHash('review')
export const HAS_MEMBER = requireRelationshipTypeHash('has-member')

export const ROLE_OWNER = requireRoleHash('owner')
export const ROLE_BOARD_MEMBER = requireRoleHash('board-member')
export const ROLE_CEO = requireRoleHash('ceo')
export const ROLE_EXECUTIVE = requireRoleHash('executive')
export const ROLE_TREASURER = requireRoleHash('treasurer')
export const ROLE_AUTHORIZED_SIGNER = requireRoleHash('authorized-signer')
export const ROLE_OFFICER = requireRoleHash('officer')
export const ROLE_CHAIR = requireRoleHash('chair')
export const ROLE_ADVISOR = requireRoleHash('advisor')
export const ROLE_ADMIN = requireRoleHash('admin')
export const ROLE_MEMBER = requireRoleHash('member')
export const ROLE_OPERATOR = requireRoleHash('operator')
export const ROLE_EMPLOYEE = requireRoleHash('employee')
export const ROLE_CONTRACTOR = requireRoleHash('contractor')
export const ROLE_AUDITOR = requireRoleHash('auditor')
export const ROLE_VALIDATOR = requireRoleHash('validator')
export const ROLE_INSURER = requireRoleHash('insurer')
export const ROLE_INSURED_PARTY = requireRoleHash('insured-party')
export const ROLE_UNDERWRITER = requireRoleHash('underwriter')
export const ROLE_CERTIFIED_BY = requireRoleHash('certified-by')
export const ROLE_LICENSED_BY = requireRoleHash('licensed-by')
export const ROLE_STAKER = requireRoleHash('staker')
export const ROLE_GUARANTOR = requireRoleHash('guarantor')
export const ROLE_BACKER = requireRoleHash('backer')
export const ROLE_COLLATERAL_PROVIDER = requireRoleHash('collateral-provider')
export const ROLE_STRATEGIC_PARTNER = requireRoleHash('strategic-partner')
export const ROLE_AFFILIATE = requireRoleHash('affiliate')
export const ROLE_ENDORSED_BY = requireRoleHash('endorsed-by')
export const ROLE_SUBSIDIARY = requireRoleHash('subsidiary')
export const ROLE_PARENT_ORG = requireRoleHash('parent-org')
export const ROLE_VENDOR = requireRoleHash('vendor')
export const ROLE_SERVICE_PROVIDER = requireRoleHash('service-provider')
export const ROLE_DELEGATED_OPERATOR = requireRoleHash('delegated-operator')
export const ROLE_RUNS_IN_TEE = requireRoleHash('runs-in-tee')
export const ROLE_ATTESTED_BY = requireRoleHash('attested-by')
export const ROLE_VERIFIED_BY = requireRoleHash('verified-by')
export const ROLE_BOUND_TO_KMS = requireRoleHash('bound-to-kms')
export const ROLE_CONTROLS_RUNTIME = requireRoleHash('controls-runtime')
export const ROLE_BUILT_FROM = requireRoleHash('built-from')
export const ROLE_DEPLOYED_FROM = requireRoleHash('deployed-from')
export const ROLE_OPERATED_AGENT = requireRoleHash('operated-agent')
export const ROLE_MANAGED_AGENT = requireRoleHash('managed-agent')
export const ROLE_ADMINISTERS = requireRoleHash('administers')
export const ROLE_ACTIVITY_VALIDATOR = requireRoleHash('activity-validator')
export const ROLE_VALIDATED_PERFORMER = requireRoleHash('validated-performer')
export const ROLE_REVIEWER = requireRoleHash('reviewer')
export const ROLE_REVIEWED_AGENT = requireRoleHash('reviewed-agent')
