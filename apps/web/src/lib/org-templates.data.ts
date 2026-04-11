import type { OrgTemplate } from './org-templates'

export const ORG_TEMPLATES: OrgTemplate[] = [
  {
    id: 'grant-org',
    name: 'Grant Organization',
    description: 'Manage grant funds, evaluate proposals, and distribute awards',
    details: 'A committee-governed organization that manages a grant fund. Includes a Treasury Agent for fund management and a Compliance Agent for regulatory oversight. Board members evaluate proposals and approve disbursements through multi-sig governance.',
    color: '#6366f1',
    defaultMinOwners: 3,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'Director', description: 'Full authority — manages organization, adds/removes members', required: true, maxCount: 2, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'treasurer', label: 'Treasurer', description: 'Manages treasury, approves disbursements within bounds', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'board-member', label: 'Grant Officer', description: 'Reviews grant proposals, recommends awards', required: false, maxCount: 3, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'auditor', label: 'Auditor', description: 'Reviews financials, submits compliance reports', required: false, maxCount: 1, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'reviewer', label: 'Reviewer', description: 'Evaluates grant applications and agent performance', required: false, maxCount: Infinity, relationshipType: 'review', generateInvite: true },
    ],
    aiAgents: [
      {
        name: 'Treasury Agent',
        agentType: 'executor',
        description: 'Manages grant fund, processes approved disbursements within delegation bounds',
        capabilities: ['treasury-management', 'proposal-execution', 'payment-processing'],
        trustModels: ['reputation', 'tee-attestation'],
        autoDeploy: true,
      },
      {
        name: 'Compliance Agent',
        agentType: 'validator',
        description: 'Monitors disbursements against grant terms, flags violations',
        capabilities: ['compliance-monitoring', 'audit-reporting', 'violation-flagging'],
        trustModels: ['reputation'],
        autoDeploy: true,
      },
    ],
  },

  {
    id: 'service-business',
    name: 'Service Business',
    description: 'Deliver services to clients, manage team and billing',
    details: 'An owner-operated service business with operations management. Includes an Operations Agent that handles scheduling, client communication, and task assignment. Simple governance with owner + operators.',
    color: '#22c55e',
    defaultMinOwners: 1,
    defaultQuorum: 1,
    roles: [
      { roleKey: 'owner', label: 'Owner', description: 'Full authority over the business', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'admin', label: 'Operations Manager', description: 'Manages service delivery and team scheduling', required: false, maxCount: 2, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'employee', label: 'Service Provider', description: 'Delivers services to clients', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'contractor', label: 'Contractor', description: 'External contractor with limited access', required: false, maxCount: Infinity, relationshipType: 'service', generateInvite: true },
    ],
    aiAgents: [
      {
        name: 'Operations Agent',
        agentType: 'assistant',
        description: 'Manages service schedules, assigns providers, handles client inquiries',
        capabilities: ['scheduling', 'task-assignment', 'client-communication'],
        trustModels: ['reputation'],
        autoDeploy: true,
      },
    ],
  },

  {
    id: 'product-collective',
    name: 'Product Collective',
    description: 'Build and sell products with a distributed team',
    details: 'A board-governed collective that builds products. Includes a Coordination Agent for team alignment and task tracking. Board members make governance decisions, operators handle day-to-day execution.',
    color: '#f59e0b',
    defaultMinOwners: 2,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'board-member', label: 'Board Member', description: 'Governance decisions, approves proposals', required: true, maxCount: 5, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'operator', label: 'Product Lead', description: 'Manages product development and delivery', required: false, maxCount: 2, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'member', label: 'Team Member', description: 'General team membership with standard access', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'service-provider', label: 'Vendor', description: 'External vendor or service provider', required: false, maxCount: Infinity, relationshipType: 'service', generateInvite: true },
    ],
    aiAgents: [
      {
        name: 'Coordination Agent',
        agentType: 'assistant',
        description: 'Tracks tasks, coordinates team activities, generates status reports',
        capabilities: ['task-tracking', 'team-coordination', 'status-reporting'],
        trustModels: ['reputation'],
        autoDeploy: true,
      },
    ],
  },

  {
    id: 'investment-club',
    name: 'Investment Club',
    description: 'Pool capital, evaluate opportunities, and make investments',
    details: 'An equal-partner investment club with majority governance. Treasury Agent holds pooled capital and executes approved investments. Research Agent evaluates opportunities with TEE attestation for data confidentiality.',
    color: '#ec4899',
    defaultMinOwners: 3,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'authorized-signer', label: 'Managing Partner', description: 'Manages operations, limited single-signer authority', required: true, maxCount: 2, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'member', label: 'Partner', description: 'Equal voting weight on investment decisions', required: true, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'advisor', label: 'Analyst', description: 'Researches opportunities, proposes investments', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'auditor', label: 'Compliance Officer', description: 'Regulatory oversight, audit access', required: false, maxCount: 1, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [
      {
        name: 'Treasury Agent',
        agentType: 'executor',
        description: 'Holds pooled capital, executes approved investments within delegation bounds',
        capabilities: ['treasury-management', 'investment-execution', 'portfolio-tracking'],
        trustModels: ['reputation', 'tee-attestation'],
        autoDeploy: true,
      },
      {
        name: 'Research Agent',
        agentType: 'discovery',
        description: 'Evaluates investment opportunities, runs analysis in TEE for confidentiality',
        capabilities: ['opportunity-analysis', 'risk-assessment', 'market-research'],
        trustModels: ['tee-attestation'],
        autoDeploy: true,
      },
    ],
  },
  // ─── Global.Church Organization Types ────────────────────────────────

  {
    id: 'church',
    name: 'Church',
    description: 'Local congregation — community of believers',
    details: 'A local church that can give and receive funds, participate in missions, and connect with denominations and networks. Multi-sig governance with pastoral leadership.',
    color: '#7c3aed',
    defaultMinOwners: 2,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'Senior Pastor', description: 'Primary leader with full authority', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'board-member', label: 'Elder / Board Member', description: 'Governance oversight and approval', required: false, maxCount: 5, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'treasurer', label: 'Treasurer', description: 'Financial oversight and fund management', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'admin', label: 'Administrator', description: 'Day-to-day operations management', required: false, maxCount: 2, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'member', label: 'Staff Member', description: 'Church staff with operational access', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [
      { name: 'Treasury Agent', agentType: 'executor', description: 'Manages church funds, processes approved disbursements', capabilities: ['treasury-management', 'payment-processing'], trustModels: ['reputation'], autoDeploy: true },
    ],
  },

  {
    id: 'denomination',
    name: 'Denomination',
    description: 'Church grouping — trust anchor and endorser',
    details: 'A denomination or church association that endorses and certifies member churches. Acts as a trust anchor in the network without direct transaction processing.',
    color: '#1d4ed8',
    defaultMinOwners: 3,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'Executive Director', description: 'Denominational leader with full authority', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'board-member', label: 'Board Member', description: 'Governing board member', required: true, maxCount: 7, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'authorized-signer', label: 'Endorsement Officer', description: 'Authorized to endorse and certify member organizations', required: true, maxCount: 3, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'auditor', label: 'Compliance Officer', description: 'Monitors member compliance with standards', required: false, maxCount: 2, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'admin', label: 'Staff', description: 'Administrative staff', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [
      { name: 'Endorsement Agent', agentType: 'validator', description: 'Manages endorsement lifecycle — certification, renewal, and revocation of member organizations', capabilities: ['endorsement-management', 'compliance-monitoring', 'membership-tracking'], trustModels: ['reputation'], autoDeploy: true },
    ],
  },

  {
    id: 'mission-agency',
    name: 'Mission Agency',
    description: 'Cross-cultural worker deployment and support',
    details: 'An organization that deploys and supports cross-cultural workers. Manages funding relationships with churches and giving intermediaries. Reports on engagement with people groups.',
    color: '#059669',
    defaultMinOwners: 2,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'Director', description: 'Agency director with full authority', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'board-member', label: 'Board Member', description: 'Governance oversight', required: false, maxCount: 5, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'treasurer', label: 'Finance Director', description: 'Financial management and reporting', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'operator', label: 'Field Director', description: 'Manages field operations and workers', required: false, maxCount: 3, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'member', label: 'Field Worker', description: 'Cross-cultural worker deployed by the agency', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [
      { name: 'Treasury Agent', agentType: 'executor', description: 'Manages agency funds, processes worker support and project disbursements', capabilities: ['treasury-management', 'worker-support', 'grant-processing'], trustModels: ['reputation'], autoDeploy: true },
      { name: 'Engagement Tracker', agentType: 'discovery', description: 'Tracks and reports engagement claims with people groups and locations', capabilities: ['engagement-tracking', 'impact-reporting', 'people-group-analysis'], trustModels: ['reputation'], autoDeploy: true },
    ],
  },

  {
    id: 'giving-intermediary',
    name: 'Giving Intermediary',
    description: 'Fund stewardship and deployment — DAFs, foundations',
    details: 'A giving intermediary (donor-advised fund, foundation, or fiscal sponsor) that receives, stewards, and deploys charitable funds. High-volume routing node in the trust fabric.',
    color: '#ca8a04',
    defaultMinOwners: 3,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'President', description: 'Organization president with full authority', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'board-member', label: 'Board Trustee', description: 'Trust oversight and fiduciary responsibility', required: true, maxCount: 7, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'treasurer', label: 'Chief Financial Officer', description: 'Financial management and stewardship', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'authorized-signer', label: 'Grant Manager', description: 'Authorized to approve and process grants', required: true, maxCount: 3, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'auditor', label: 'Compliance Officer', description: 'Regulatory compliance and audit', required: false, maxCount: 2, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [
      { name: 'Treasury Agent', agentType: 'executor', description: 'Manages fund disbursements, tracks grants, processes donor-advised distributions', capabilities: ['treasury-management', 'grant-processing', 'donor-management', 'disbursement-tracking'], trustModels: ['reputation', 'tee-attestation'], autoDeploy: true },
      { name: 'Compliance Agent', agentType: 'validator', description: 'Monitors grant compliance, verifies recipient eligibility, tracks outcomes', capabilities: ['compliance-monitoring', 'recipient-verification', 'outcome-tracking'], trustModels: ['reputation'], autoDeploy: true },
    ],
  },

  {
    id: 'accreditation-body',
    name: 'Accreditation Body',
    description: 'Standards evaluation and certification authority',
    details: 'An accreditation body that evaluates organizations against governance and operational standards. Acts as a behavioral trust anchor — endorsement signals verified compliance.',
    color: '#dc2626',
    defaultMinOwners: 3,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'Executive Director', description: 'Organization leader', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'board-member', label: 'Board Member', description: 'Standards governance', required: true, maxCount: 5, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'reviewer', label: 'Standards Reviewer', description: 'Evaluates organizations against accreditation standards', required: true, maxCount: Infinity, relationshipType: 'review', generateInvite: true },
      { roleKey: 'auditor', label: 'Compliance Auditor', description: 'Conducts compliance audits', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [
      { name: 'Accreditation Agent', agentType: 'validator', description: 'Manages accreditation lifecycle — applications, reviews, certifications, and renewals', capabilities: ['accreditation-management', 'standards-evaluation', 'certification-tracking'], trustModels: ['reputation'], autoDeploy: true },
    ],
  },

  {
    id: 'network',
    name: 'Network / Coalition',
    description: 'Relational collaboration around shared focus',
    details: 'A network or coalition of organizations collaborating around a shared mission or geographic focus. Membership-based with lightweight governance.',
    color: '#0891b2',
    defaultMinOwners: 1,
    defaultQuorum: 1,
    roles: [
      { roleKey: 'owner', label: 'Coordinator', description: 'Network coordinator with administrative authority', required: true, maxCount: 2, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'member', label: 'Member Organization', description: 'Participating organization in the network', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'advisor', label: 'Advisory Council', description: 'Strategic advisory role', required: false, maxCount: 10, relationshipType: 'governance', generateInvite: true },
    ],
    aiAgents: [],
  },

  {
    id: 'seminary',
    name: 'Seminary / Training Institution',
    description: 'Theological training and capacity building',
    details: 'An educational institution providing theological training, leadership development, and capacity building for ministry organizations.',
    color: '#4f46e5',
    defaultMinOwners: 2,
    defaultQuorum: 2,
    roles: [
      { roleKey: 'owner', label: 'President', description: 'Institutional leader', required: true, maxCount: 1, relationshipType: 'governance', generateInvite: false },
      { roleKey: 'board-member', label: 'Board of Trustees', description: 'Governance oversight', required: false, maxCount: 7, relationshipType: 'governance', generateInvite: true },
      { roleKey: 'admin', label: 'Academic Dean', description: 'Academic program management', required: false, maxCount: 2, relationshipType: 'membership', generateInvite: true },
      { roleKey: 'member', label: 'Faculty', description: 'Teaching faculty', required: false, maxCount: Infinity, relationshipType: 'membership', generateInvite: true },
    ],
    aiAgents: [],
  },
]

export function getOrgTemplate(id: string): OrgTemplate | undefined {
  return ORG_TEMPLATES.find(t => t.id === id)
}
