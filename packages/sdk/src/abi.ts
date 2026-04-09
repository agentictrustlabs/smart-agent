// ─── AgentRootAccount ABI ────────────────────────────────────────────

export const agentRootAccountAbi = [
  { type: 'function', name: 'addOwner', inputs: [{ name: 'owner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'removeOwner', inputs: [{ name: 'owner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'isOwner', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'ownerCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'entryPoint', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'getNonce', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'initialize', inputs: [{ name: 'initialOwner', type: 'address' }, { name: 'serverSigner', type: 'address' }, { name: 'dm', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'execute', inputs: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'executeBatch', inputs: [{ name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'isValidSignature', inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }], outputs: [{ name: '', type: 'bytes4' }], stateMutability: 'view' },
  { type: 'function', name: 'setDelegationManager', inputs: [{ name: 'dm', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'delegationManager', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'version', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'pure' },
  { type: 'function', name: 'upgradeToAndCall', inputs: [{ name: 'newImplementation', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'proxiableUUID', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'event', name: 'OwnerAdded', inputs: [{ name: 'owner', type: 'address', indexed: true }] },
  { type: 'event', name: 'OwnerRemoved', inputs: [{ name: 'owner', type: 'address', indexed: true }] },
  { type: 'event', name: 'Upgraded', inputs: [{ name: 'implementation', type: 'address', indexed: true }] },
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
          { name: 'args', type: 'bytes' },
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
      { name: 'args', type: 'bytes' },
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
  { type: 'function', name: 'confirmEdge', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'rejectEdge', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'activateEdge', inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
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

// ─── AgentRelationshipTemplate ABI (Description Layer) ───────────────

export const agentTemplateAbi = [
  {
    type: 'function', name: 'createTemplate',
    inputs: [
      { name: 'relationshipType', type: 'bytes32' },
      { name: 'role', type: 'bytes32' },
      { name: 'name', type: 'string' },
      { name: 'templateDescription', type: 'string' },
      { name: 'caveats', type: 'tuple[]', components: [
        { name: 'enforcer', type: 'address' },
        { name: 'required', type: 'bool' },
        { name: 'defaultTerms', type: 'bytes' },
      ]},
      { name: 'delegationSchemaURI', type: 'string' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [{ name: 'templateId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  { type: 'function', name: 'deactivateTemplate', inputs: [{ name: 'templateId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'activateTemplate', inputs: [{ name: 'templateId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function', name: 'getTemplate',
    inputs: [{ name: 'templateId', type: 'uint256' }],
    outputs: [
      { name: 'id_', type: 'uint256' },
      { name: 'relationshipType', type: 'bytes32' },
      { name: 'role', type: 'bytes32' },
      { name: 'name', type: 'string' },
      { name: 'templateDescription', type: 'string' },
      { name: 'delegationSchemaURI', type: 'string' },
      { name: 'metadataURI', type: 'string' },
      { name: 'createdBy', type: 'address' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getCaveatRequirements',
    inputs: [{ name: 'templateId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple[]', components: [
      { name: 'enforcer', type: 'address' },
      { name: 'required', type: 'bool' },
      { name: 'defaultTerms', type: 'bytes' },
    ]}],
    stateMutability: 'view',
  },
  { type: 'function', name: 'getTemplatesByTypeAndRole', inputs: [{ name: 'relationshipType', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'templateCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  // Events
  { type: 'event', name: 'TemplateCreated', inputs: [{ name: 'templateId', type: 'uint256', indexed: true }, { name: 'relationshipType', type: 'bytes32', indexed: true }, { name: 'role', type: 'bytes32', indexed: true }, { name: 'name', type: 'string', indexed: false }, { name: 'createdBy', type: 'address', indexed: false }] },
] as const

// ─── AgentIssuerProfile ABI ──────────────────────────────────────────

export const agentIssuerProfileAbi = [
  { type: 'function', name: 'registerIssuer', inputs: [{ name: 'issuer', type: 'address' }, { name: 'issuerType', type: 'bytes32' }, { name: 'name', type: 'string' }, { name: 'description', type: 'string' }, { name: 'validationMethods', type: 'bytes32[]' }, { name: 'claimTypes', type: 'bytes32[]' }, { name: 'metadataURI', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getProfile', inputs: [{ name: 'issuer', type: 'address' }], outputs: [{ name: 'issuer_', type: 'address' }, { name: 'issuerType', type: 'bytes32' }, { name: 'name', type: 'string' }, { name: 'description', type: 'string' }, { name: 'metadataURI', type: 'string' }, { name: 'registeredAt', type: 'uint256' }, { name: 'active', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getValidationMethods', inputs: [{ name: 'issuer', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getClaimTypes', inputs: [{ name: 'issuer', type: 'address' }], outputs: [{ name: '', type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'isRegistered', inputs: [{ name: 'issuer', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'isActive', inputs: [{ name: 'issuer', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getIssuersByType', inputs: [{ name: 'issuerType', type: 'bytes32' }], outputs: [{ name: '', type: 'address[]' }], stateMutability: 'view' },
  { type: 'function', name: 'issuerCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getIssuerAt', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  // Constants
  { type: 'function', name: 'ISSUER_VALIDATOR', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ISSUER_INSURER', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ISSUER_AUDITOR', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ISSUER_TEE_VERIFIER', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ISSUER_STAKING_POOL', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ISSUER_GOVERNANCE', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'ISSUER_ORACLE', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'event', name: 'IssuerRegistered', inputs: [{ name: 'issuer', type: 'address', indexed: true }, { name: 'issuerType', type: 'bytes32', indexed: true }, { name: 'name', type: 'string', indexed: false }] },
] as const

// ─── AgentValidationProfile ABI ──────────────────────────────────────

export const agentValidationProfileAbi = [
  { type: 'function', name: 'recordValidation', inputs: [{ name: 'assertionId', type: 'uint256' }, { name: 'validationMethod', type: 'bytes32' }, { name: 'verifierContract', type: 'address' }, { name: 'teeArch', type: 'bytes32' }, { name: 'codeMeasurement', type: 'bytes32' }, { name: 'evidenceURI', type: 'string' }], outputs: [{ name: 'validationId', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getValidation', inputs: [{ name: 'validationId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'validationId', type: 'uint256' }, { name: 'assertionId', type: 'uint256' }, { name: 'validationMethod', type: 'bytes32' }, { name: 'verifierContract', type: 'address' }, { name: 'teeArch', type: 'bytes32' }, { name: 'codeMeasurement', type: 'bytes32' }, { name: 'evidenceURI', type: 'string' }, { name: 'validatedBy', type: 'address' }, { name: 'validatedAt', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getValidationsByAssertion', inputs: [{ name: 'assertionId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getValidationsByValidator', inputs: [{ name: 'validator', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'validationCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  // TEE arch constants
  { type: 'function', name: 'TEE_NITRO', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'TEE_TDX', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'TEE_SGX', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'TEE_SEV', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'event', name: 'ValidationRecorded', inputs: [{ name: 'validationId', type: 'uint256', indexed: true }, { name: 'assertionId', type: 'uint256', indexed: true }, { name: 'validationMethod', type: 'bytes32', indexed: false }, { name: 'validatedBy', type: 'address', indexed: true }] },
] as const

// ─── AgentReviewRecord ABI ───────────────────────────────────────────

export const agentReviewRecordAbi = [
  { type: 'function', name: 'createReview', inputs: [{ name: 'reviewer', type: 'address' }, { name: 'subject', type: 'address' }, { name: 'reviewType', type: 'bytes32' }, { name: 'recommendation', type: 'bytes32' }, { name: 'overallScore', type: 'uint8' }, { name: 'dimensions', type: 'tuple[]', components: [{ name: 'dimension', type: 'bytes32' }, { name: 'score', type: 'uint8' }] }, { name: 'comment', type: 'string' }, { name: 'evidenceURI', type: 'string' }], outputs: [{ name: 'reviewId', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getReview', inputs: [{ name: 'reviewId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'reviewId', type: 'uint256' }, { name: 'reviewer', type: 'address' }, { name: 'subject', type: 'address' }, { name: 'reviewType', type: 'bytes32' }, { name: 'recommendation', type: 'bytes32' }, { name: 'overallScore', type: 'uint8' }, { name: 'signedValue', type: 'int128' }, { name: 'valueDecimals', type: 'uint8' }, { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }, { name: 'endpoint', type: 'string' }, { name: 'comment', type: 'string' }, { name: 'evidenceURI', type: 'string' }, { name: 'feedbackHash', type: 'bytes32' }, { name: 'createdAt', type: 'uint256' }, { name: 'revoked', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getDimensions', inputs: [{ name: 'reviewId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple[]', components: [{ name: 'dimension', type: 'bytes32' }, { name: 'score', type: 'uint8' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getReviewsBySubject', inputs: [{ name: 'subject', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getAverageScore', inputs: [{ name: 'subject', type: 'address' }], outputs: [{ name: 'avg', type: 'uint256' }, { name: 'count', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'reviewCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'event', name: 'ReviewCreated', inputs: [{ name: 'reviewId', type: 'uint256', indexed: true }, { name: 'reviewer', type: 'address', indexed: true }, { name: 'subject', type: 'address', indexed: true }, { name: 'reviewType', type: 'bytes32', indexed: false }, { name: 'recommendation', type: 'bytes32', indexed: false }, { name: 'overallScore', type: 'uint8', indexed: false }] },
] as const

// ─── AgentDisputeRecord ABI ──────────────────────────────────────────

export const agentDisputeRecordAbi = [
  { type: 'function', name: 'fileDispute', inputs: [{ name: 'subject', type: 'address' }, { name: 'disputeType', type: 'uint8' }, { name: 'reason', type: 'string' }, { name: 'evidenceURI', type: 'string' }], outputs: [{ name: 'disputeId', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'resolveDispute', inputs: [{ name: 'disputeId', type: 'uint256' }, { name: 'newStatus', type: 'uint8' }, { name: 'resolutionNote', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getDispute', inputs: [{ name: 'disputeId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'disputeId', type: 'uint256' }, { name: 'subject', type: 'address' }, { name: 'filedBy', type: 'address' }, { name: 'disputeType', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'reason', type: 'string' }, { name: 'evidenceURI', type: 'string' }, { name: 'resolvedBy', type: 'address' }, { name: 'resolutionNote', type: 'string' }, { name: 'filedAt', type: 'uint256' }, { name: 'resolvedAt', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getDisputesBySubject', inputs: [{ name: 'subject', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getOpenDisputeCount', inputs: [{ name: 'subject', type: 'address' }], outputs: [{ name: 'count', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'disputeCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'event', name: 'DisputeFiled', inputs: [{ name: 'disputeId', type: 'uint256', indexed: true }, { name: 'subject', type: 'address', indexed: true }, { name: 'filedBy', type: 'address', indexed: true }, { name: 'disputeType', type: 'uint8', indexed: false }] },
] as const

// ─── AgentTrustProfile ABI ───────────────────────────────────────────

export const agentTrustProfileAbi = [
  { type: 'function', name: 'checkDiscoveryTrust', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'passes', type: 'bool' }, { name: 'score', type: 'uint256' }, { name: 'edgeCount', type: 'uint256' }, { name: 'reviewCount', type: 'uint256' }, { name: 'avgReviewScore', type: 'uint256' }, { name: 'openDisputes', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'checkExecutionTrust', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'passes', type: 'bool' }, { name: 'score', type: 'uint256' }, { name: 'edgeCount', type: 'uint256' }, { name: 'reviewCount', type: 'uint256' }, { name: 'avgReviewScore', type: 'uint256' }, { name: 'openDisputes', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'isTrusted', inputs: [{ name: 'agent', type: 'address' }, { name: 'threshold', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const

// ─── AgentControl ABI (Governance) ───────────────────────────────────

export const agentControlAbi = [
  { type: 'function', name: 'initializeAgent', inputs: [{ name: 'agent', type: 'address' }, { name: 'minOwners', type: 'uint256' }, { name: 'quorum', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'addOwner', inputs: [{ name: 'agent', type: 'address' }, { name: 'newOwner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'removeOwner', inputs: [{ name: 'agent', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setQuorum', inputs: [{ name: 'agent', type: 'address' }, { name: 'newQuorum', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'createProposal', inputs: [{ name: 'agent', type: 'address' }, { name: 'actionClass', type: 'uint8' }, { name: 'data', type: 'bytes' }], outputs: [{ name: 'proposalId', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'approveProposal', inputs: [{ name: 'agent', type: 'address' }, { name: 'proposalId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getConfig', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'minOwners', type: 'uint256' }, { name: 'quorum', type: 'uint256' }, { name: 'isBootstrap', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getOwners', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'address[]' }], stateMutability: 'view' },
  { type: 'function', name: 'isOwner', inputs: [{ name: 'agent', type: 'address' }, { name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'ownerCount', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'isInitialized', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'isGovernanceReady', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'canAct', inputs: [{ name: 'agent', type: 'address' }, { name: 'caller', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getProposal', inputs: [{ name: 'agent', type: 'address' }, { name: 'proposalId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'proposalId', type: 'uint256' }, { name: 'agent', type: 'address' }, { name: 'actionClass', type: 'uint8' }, { name: 'data', type: 'bytes' }, { name: 'proposer', type: 'address' }, { name: 'createdAt', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'approvalCount', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'proposalCount', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'event', name: 'AgentInitialized', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'minOwners', type: 'uint256', indexed: false }, { name: 'quorum', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ProposalCreated', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'proposalId', type: 'uint256', indexed: true }, { name: 'actionClass', type: 'uint8', indexed: false }, { name: 'proposer', type: 'address', indexed: false }] },
  { type: 'event', name: 'ProposalApproved', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'proposalId', type: 'uint256', indexed: true }, { name: 'approver', type: 'address', indexed: true }] },
  { type: 'event', name: 'ProposalExecuted', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'proposalId', type: 'uint256', indexed: true }] },
] as const
