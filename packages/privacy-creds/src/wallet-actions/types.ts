/**
 * EIP-712 typed-data envelope for Smart Agent SSI wallet actions.
 *
 * Privy (user EOA) signs a WalletAction. ssi-wallet-mcp verifies the signature
 * before using the link secret or generating any presentation. person-mcp
 * mints these envelopes after its own consent/policy checks.
 *
 * INVARIANTS
 *  - Privy signs; ssi-wallet-mcp uses the link secret. Split authority.
 *  - Every action carries purpose, verifier/issuer, nonce, expiry, allow/deny.
 *  - The *full* proof-request body is NOT in the envelope; its keccak lives in
 *    `proofRequestHash` so a tampered request body is detected.
 */

export type WalletActionType =
  | 'ProvisionHolderWallet'
  | 'AcceptCredentialOffer'
  | 'CreatePresentation'
  | 'RevokeCredential'
  | 'RotateLinkSecret'

export interface WalletAction {
  type: WalletActionType
  actionId: string
  personPrincipal: string
  /** Context label — every wallet belongs to a (principal, context) pair.
   *  Common values: "default", "professional", "personal", "ai-delegate". */
  walletContext: string
  holderWalletId: string
  counterpartyId: string
  purpose: string
  credentialType: string
  proofRequestHash: `0x${string}`
  allowedReveal: string
  allowedPredicates: string
  forbiddenAttrs: string
  nonce: `0x${string}`
  expiresAt: bigint
}

/** Default forbidden attribute list — ssi-wallet-mcp enforces this on every
 *  presentation, even if the signed action technically permits it. */
export const DEFAULT_FORBIDDEN_ATTRS = [
  'legalName',
  'email',
  'phone',
  'dob',
  'dateOfBirth',
  'address',
  'ssn',
  'globalPersonId',
  'privyWalletAddress',
] as const

export function walletActionDomain(chainId: number, verifyingContract: `0x${string}`) {
  return {
    name: 'SmartAgent SSI Wallet Action',
    version: '1',
    chainId,
    verifyingContract,
  } as const
}

export const WalletActionTypes = {
  WalletAction: [
    { name: 'type',              type: 'string'  },
    { name: 'actionId',          type: 'string'  },
    { name: 'personPrincipal',   type: 'string'  },
    { name: 'walletContext',     type: 'string'  },
    { name: 'holderWalletId',    type: 'string'  },
    { name: 'counterpartyId',    type: 'string'  },
    { name: 'purpose',           type: 'string'  },
    { name: 'credentialType',    type: 'string'  },
    { name: 'proofRequestHash',  type: 'bytes32' },
    { name: 'allowedReveal',     type: 'string'  },
    { name: 'allowedPredicates', type: 'string'  },
    { name: 'forbiddenAttrs',    type: 'string'  },
    { name: 'nonce',             type: 'bytes32' },
    { name: 'expiresAt',         type: 'uint64'  },
  ],
} as const
