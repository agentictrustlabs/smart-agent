/**
 * Organization Template types.
 *
 * Templates define the governance structure, role slots, AI agents,
 * and delegation patterns for an organization. When a founder selects
 * a template, the setup wizard auto-deploys everything.
 */

export interface OrgTemplateRoleSlot {
  /** Internal key matching SDK role constants (e.g., 'treasurer', 'member') */
  roleKey: string
  /** Human-readable label */
  label: string
  /** Description shown in role picker */
  description: string
  /** Must be filled during org setup? */
  required: boolean
  /** Maximum people in this role (Infinity for unlimited) */
  maxCount: number
  /** Relationship type for this role */
  relationshipType: 'governance' | 'membership' | 'service' | 'review'
  /** Generate invite link at setup? */
  generateInvite: boolean
}

export interface OrgTemplateAIAgent {
  /** Agent name */
  name: string
  /** AI agent subtype */
  agentType: 'executor' | 'validator' | 'assistant' | 'oracle' | 'discovery' | 'custom'
  /** Description */
  description: string
  /** Capabilities this agent has */
  capabilities: string[]
  /** Trust models it supports */
  trustModels: string[]
  /** Deploy automatically during setup */
  autoDeploy: boolean
}

export interface OrgTemplate {
  /** Unique template ID */
  id: string
  /** Template display name */
  name: string
  /** Short description */
  description: string
  /** Longer explanation of what this org type is for */
  details: string
  /** Color accent for the template card */
  color: string

  /** Governance defaults */
  defaultMinOwners: number
  defaultQuorum: number

  /** Role slots defined by this template */
  roles: OrgTemplateRoleSlot[]

  /** AI agents to auto-deploy */
  aiAgents: OrgTemplateAIAgent[]
}
