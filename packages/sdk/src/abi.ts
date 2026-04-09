// ─── AgentRootAccount ABI ────────────────────────────────────────────

export const agentRootAccountAbi = [
  { type: 'function', name: 'addOwner', inputs: [{ name: 'owner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'removeOwner', inputs: [{ name: 'owner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'isOwner', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'ownerCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'entryPoint', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'getNonce', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'initialize', inputs: [{ name: 'initialOwner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'execute', inputs: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'executeBatch', inputs: [{ name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'isValidSignature', inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }], outputs: [{ name: '', type: 'bytes4' }], stateMutability: 'view' },
  { type: 'event', name: 'OwnerAdded', inputs: [{ name: 'owner', type: 'address', indexed: true }] },
  { type: 'event', name: 'OwnerRemoved', inputs: [{ name: 'owner', type: 'address', indexed: true }] },
] as const

// ─── AgentAccountFactory ABI ─────────────────────────────────────────

export const agentAccountFactoryAbi = [
  { type: 'function', name: 'createAccount', inputs: [{ name: 'owner', type: 'address' }, { name: 'salt', type: 'uint256' }], outputs: [{ name: 'account', type: 'address' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getAddress', inputs: [{ name: 'owner', type: 'address' }, { name: 'salt', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'accountImplementation', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'event', name: 'AgentAccountCreated', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'owner', type: 'address', indexed: true }, { name: 'salt', type: 'uint256', indexed: false }] },
] as const

// ─── DelegationManager ABI ───────────────────────────────────────────

export const delegationManagerAbi = [
  {
    type: 'function', name: 'redeemDelegation',
    inputs: [
      { name: 'delegations', type: 'tuple[]', components: [
        { name: 'delegator', type: 'address' },
        { name: 'delegate', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        { name: 'caveats', type: 'tuple[]', components: [
          { name: 'enforcer', type: 'address' },
          { name: 'terms', type: 'bytes' },
        ]},
        { name: 'salt', type: 'uint256' },
        { name: 'signature', type: 'bytes' },
      ]},
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  { type: 'function', name: 'revokeDelegation', inputs: [{ name: 'delegationHash', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'isRevoked', inputs: [{ name: 'delegationHash', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'hashDelegation', inputs: [{ name: 'd', type: 'tuple', components: [
    { name: 'delegator', type: 'address' },
    { name: 'delegate', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'tuple[]', components: [
      { name: 'enforcer', type: 'address' },
      { name: 'terms', type: 'bytes' },
    ]},
    { name: 'salt', type: 'uint256' },
    { name: 'signature', type: 'bytes' },
  ]}], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROOT_AUTHORITY', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'event', name: 'DelegationRedeemed', inputs: [{ name: 'delegationHash', type: 'bytes32', indexed: true }, { name: 'delegator', type: 'address', indexed: true }, { name: 'delegate', type: 'address', indexed: true }] },
  { type: 'event', name: 'DelegationRevoked', inputs: [{ name: 'delegationHash', type: 'bytes32', indexed: true }] },
] as const

// ─── AgentRelationship ABI (Edge Layer) ──────────────────────────────

export const agentRelationshipAbi = [
  { type: 'function', name: 'createEdge', inputs: [{ name: 'subject', type: 'address' }, { name: 'object_', type: 'address' }, { name: 'relationshipType', type: 'bytes32' }, { name: 'initialRoles', type: 'bytes32[]' }, { name: 'metadataURI', type: 'string' }], outputs: [{ name: 'edgeId', type: 'bytes32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'addRole', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'removeRole', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setEdgeStatus', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'newStatus', type: 'uint8' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setMetadataURI', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'metadataURI', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'computeEdgeId', inputs: [{ name: 'subject', type: 'address' }, { name: 'object_', type: 'address' }, { name: 'relationshipType', type: 'bytes32' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'pure' },
  { type: 'function', name: 'getEdge', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'edgeId', type: 'bytes32' }, { name: 'subject', type: 'address' }, { name: 'object_', type: 'address' }, { name: 'relationshipType', type: 'bytes32' }, { name: 'status', type: 'uint8' }, { name: 'createdBy', type: 'address' }, { name: 'createdAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }, { name: 'metadataURI', type: 'string' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getRoles', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [{ name: '', type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'hasRole', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'edgeExists', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getEdgesBySubject', inputs: [{ name: 'subject', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getEdgesByObject', inputs: [{ name: 'object_', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getEdgeByTriple', inputs: [{ name: 'subject', type: 'address' }, { name: 'object_', type: 'address' }, { name: 'relationshipType', type: 'bytes32' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  // Constants
  { type: 'function', name: 'ORGANIZATION_MEMBERSHIP', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'DELEGATION_AUTHORITY', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'VALIDATION_TRUST', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'SERVICE_AGREEMENT', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROLE_OWNER', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROLE_ADMIN', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROLE_MEMBER', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROLE_OPERATOR', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROLE_AUDITOR', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ROLE_VENDOR', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  // Events
  { type: 'event', name: 'EdgeCreated', inputs: [{ name: 'edgeId', type: 'bytes32', indexed: true }, { name: 'subject', type: 'address', indexed: true }, { name: 'object_', type: 'address', indexed: true }, { name: 'role', type: 'bytes32', indexed: false }, { name: 'relationshipType', type: 'bytes32', indexed: false }, { name: 'createdBy', type: 'address', indexed: false }] },
  { type: 'event', name: 'EdgeStatusUpdated', inputs: [{ name: 'edgeId', type: 'bytes32', indexed: true }, { name: 'status', type: 'uint8', indexed: false }, { name: 'updater', type: 'address', indexed: true }] },
] as const

// ─── AgentAssertion ABI (Provenance Layer) ───────────────────────────

export const agentAssertionAbi = [
  { type: 'function', name: 'makeAssertion', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'assertionType', type: 'uint8' }, { name: 'validFrom', type: 'uint256' }, { name: 'validUntil', type: 'uint256' }, { name: 'evidenceURI', type: 'string' }], outputs: [{ name: 'assertionId', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeAssertion', inputs: [{ name: 'assertionId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getAssertion', inputs: [{ name: 'assertionId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'assertionId', type: 'uint256' }, { name: 'edgeId', type: 'bytes32' }, { name: 'assertionType', type: 'uint8' }, { name: 'asserter', type: 'address' }, { name: 'validFrom', type: 'uint256' }, { name: 'validUntil', type: 'uint256' }, { name: 'revoked', type: 'bool' }, { name: 'evidenceURI', type: 'string' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getAssertionsByEdge', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getAssertionsByAsserter', inputs: [{ name: 'asserter', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'assertionCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'isAssertionCurrentlyValid', inputs: [{ name: 'assertionId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  // Events
  { type: 'event', name: 'AssertionMade', inputs: [{ name: 'assertionId', type: 'uint256', indexed: true }, { name: 'edgeId', type: 'bytes32', indexed: true }, { name: 'assertionType', type: 'uint8', indexed: false }, { name: 'asserter', type: 'address', indexed: true }, { name: 'validFrom', type: 'uint256', indexed: false }, { name: 'validUntil', type: 'uint256', indexed: false }, { name: 'evidenceURI', type: 'string', indexed: false }] },
  { type: 'event', name: 'AssertionRevoked', inputs: [{ name: 'assertionId', type: 'uint256', indexed: true }, { name: 'revoker', type: 'address', indexed: true }] },
] as const

// ─── AgentRelationshipResolver ABI (Policy Layer) ────────────────────

export const agentResolverAbi = [
  { type: 'function', name: 'isRelationshipActive', inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'mode', type: 'uint8' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'holdsRole', inputs: [{ name: 'subject', type: 'address' }, { name: 'object_', type: 'address' }, { name: 'role', type: 'bytes32' }, { name: 'relationshipType', type: 'bytes32' }, { name: 'mode', type: 'uint8' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getActiveRoles', inputs: [{ name: 'subject', type: 'address' }, { name: 'object_', type: 'address' }, { name: 'relationshipType', type: 'bytes32' }, { name: 'mode', type: 'uint8' }], outputs: [{ name: 'roles', type: 'bytes32[]' }], stateMutability: 'view' },
] as const
