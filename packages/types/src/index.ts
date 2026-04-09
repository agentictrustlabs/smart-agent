// ─── ERC-4337 Types ─────────────────────────────────────────────────

/** ERC-4337 UserOperation (EntryPoint v0.7 packed format) */
export interface PackedUserOperation {
  sender: `0x${string}`
  nonce: bigint
  initCode: `0x${string}`
  callData: `0x${string}`
  accountGasLimits: `0x${string}`
  preVerificationGas: bigint
  gasFees: `0x${string}`
  paymasterAndData: `0x${string}`
  signature: `0x${string}`
}

// ─── Agent Account Types ────────────────────────────────────────────

/** Deployed agent smart account */
export interface AgentAccount {
  address: `0x${string}`
  owners: `0x${string}`[]
  chainId: number
  salt: bigint
  deploymentTxHash: `0x${string}` | null
  createdAt: Date
}

export interface CreateAgentAccountParams {
  owner: `0x${string}`
  salt: bigint
  chainId: number
}

// ─── Delegation Types ───────────────────────────────────────────────

/** On-chain caveat — references an enforcer contract (ERC-7710 / DeleGator aligned) */
export interface Caveat {
  enforcer: `0x${string}`
  terms: `0x${string}`
  args: `0x${string}`  // redeemer-provided runtime arguments (excluded from delegation hash)
}

/** Signed delegation from delegator to delegate */
export interface Delegation {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}` // ROOT_AUTHORITY or parent delegation hash
  caveats: Caveat[]
  salt: bigint
  signature: `0x${string}`
}

/** Root authority constant */
export const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as const

/** Supported caveat types — maps to our enforcer contracts */
export type CaveatType = 'timestamp' | 'value' | 'allowedTargets' | 'allowedMethods'

// ─── Session Types ──────────────────────────────────────────────────

/** An agent session — a delegation-bound temporary key */
export interface AgentSession {
  id: string
  rootAccount: `0x${string}`
  sessionKey: `0x${string}`
  sessionPrivateKey: `0x${string}`
  caveats: Caveat[]
  expiresAt: Date
  status: SessionStatus
  createdAt: Date
}

export type SessionStatus = 'active' | 'expired' | 'revoked'

export interface CreateSessionParams {
  rootAccount: `0x${string}`
  caveats: Caveat[]
  durationSeconds: number
}

/** Packaged session ready for runtime use */
export interface SessionPackage {
  session: AgentSession
  chainId: number
  delegations: Delegation[]
}

// ─── Autonomy Types ─────────────────────────────────────────────────

export type AutonomyMode =
  | 'human_confirmed'
  | 'policy_confirmed'
  | 'fully_autonomous'
  | 'emergency_lockdown'

// ─── Trust / Relationship Types ─────────────────────────────────────

export interface AgentRelationship {
  id: string
  fromAgent: `0x${string}`
  toAgent: `0x${string}`
  relationshipType: RelationshipType
  createdAt: Date
}

export type RelationshipType =
  | 'validates'
  | 'delegates_to'
  | 'member_of'
  | 'approved_vendor'
  | 'parent_org'
  | 'child_org'

export interface AgentMetadata {
  name: string
  description: string
  metadataURI: string
  supportedTools: string[]
  trustMechanisms: string[]
}

// ─── Deployed Contract Addresses ────────────────────────────────────

export interface DeployedContracts {
  agentAccountFactory: `0x${string}`
  delegationManager: `0x${string}`
  entryPoint: `0x${string}`
  enforcers: {
    timestamp: `0x${string}`
    value: `0x${string}`
    allowedTargets: `0x${string}`
    allowedMethods: `0x${string}`
  }
}

// ─── Chain Configuration ────────────────────────────────────────────

export const SUPPORTED_CHAINS = {
  sepolia: { chainId: 11155111, name: 'Sepolia', isTestnet: true },
  baseSepolia: { chainId: 84532, name: 'Base Sepolia', isTestnet: true },
} as const

export type SupportedChainId = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]['chainId']

export const ENTRYPOINT_V07_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const
