/**
 * Togo Revenue-Sharing Pilot — Derived role definitions
 *
 * Maps org template roles to specific delegation authority for the Togo use case.
 * These are consumed by the general delegation UI when the org template matches.
 */

/** What delegation bounds each Togo role gets */
export interface TogoDelegationConfig {
  roleKey: string
  label: string
  /** Methods the role can call on treasury/org agent */
  allowedMethods: string[]
  /** Max ETH value per transaction (0 = no value transfers) */
  maxValueEth: number
  /** Duration in days before delegation expires */
  durationDays: number
  /** Description shown in the UI */
  description: string
}

/** Delegation configs by org template type */
export const TOGO_DELEGATION_CONFIGS: Record<string, TogoDelegationConfig[]> = {
  'impact-investor': [
    {
      roleKey: 'owner', label: 'Managing Director',
      allowedMethods: ['transfer', 'execute', 'approve'],
      maxValueEth: 10, durationDays: 90,
      description: 'Full treasury authority — deploy capital, collect revenue share, manage portfolio',
    },
    {
      roleKey: 'authorized-signer', label: 'Capital Officer',
      allowedMethods: ['transfer', 'approve'],
      maxValueEth: 5, durationDays: 30,
      description: 'Approve capital deployments up to 5 ETH per transaction',
    },
    {
      roleKey: 'operator', label: 'Field Operations',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 30,
      description: 'Read-only portfolio access, submit revenue verification reports',
    },
    {
      roleKey: 'auditor', label: 'Compliance Officer',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 90,
      description: 'Audit trail access, compliance report generation',
    },
  ],
  'field-agency': [
    {
      roleKey: 'owner', label: 'Agency Director',
      allowedMethods: ['execute'],
      maxValueEth: 1, durationDays: 90,
      description: 'Manage field operations, approve training certifications',
    },
    {
      roleKey: 'operator', label: 'Operations Lead',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 30,
      description: 'Manage field staff, coordinate business visits, verify revenue reports',
    },
    {
      roleKey: 'member', label: 'Field Staff',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 30,
      description: 'Submit training completions, business visit reports',
    },
    {
      roleKey: 'reviewer', label: 'Training Assessor',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 90,
      description: 'Assess training fidelity, verify BDC module completions, score businesses',
    },
  ],
  'oversight-committee': [
    {
      roleKey: 'owner', label: 'Committee Chair',
      allowedMethods: ['execute'],
      maxValueEth: 0, durationDays: 90,
      description: 'Lead committee proceedings, execute passed proposals',
    },
    {
      roleKey: 'board-member', label: 'Committee Member',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 90,
      description: 'Vote on proposals, review portfolio health, approve escalations',
    },
    {
      roleKey: 'auditor', label: 'Observer',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 90,
      description: 'Read-only access to all OOC proceedings and data',
    },
  ],
  'portfolio-business': [
    {
      roleKey: 'owner', label: 'Business Owner',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 30,
      description: 'Submit monthly revenue reports, view training progress, see business health',
    },
    {
      roleKey: 'advisor', label: 'Business Coach',
      allowedMethods: [],
      maxValueEth: 0, durationDays: 30,
      description: 'View business health, submit coaching notes, verify training completions',
    },
  ],
}

/** Get delegation config for a specific template and role */
export function getTogoDelegationConfig(templateId: string, roleKey: string): TogoDelegationConfig | undefined {
  return TOGO_DELEGATION_CONFIGS[templateId]?.find(c => c.roleKey === roleKey)
}

/** Check if a template is part of the Togo pilot */
export function isTogoTemplate(templateId: string | null | undefined): boolean {
  return ['impact-investor', 'field-agency', 'oversight-committee', 'portfolio-business'].includes(templateId ?? '')
}
