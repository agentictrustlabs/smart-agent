import type { PublicClient, WalletClient } from 'viem'
import { encodeAbiParameters, encodePacked, keccak256, toBytes, decodeAbiParameters } from 'viem'
import { delegationManagerAbi } from './abi'
import type { Delegation, Caveat, DeployedContracts } from '@smart-agent/types'
import { ROOT_AUTHORITY } from '@smart-agent/types'

export { ROOT_AUTHORITY }

export interface DelegationClientConfig {
  publicClient: PublicClient
  walletClient: WalletClient
  delegationManagerAddress: `0x${string}`
}

/**
 * Client for issuing, signing, and redeeming delegations.
 */
export class DelegationClient {
  private publicClient: PublicClient
  private walletClient: WalletClient
  private delegationManagerAddress: `0x${string}`

  constructor(config: DelegationClientConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient
    this.delegationManagerAddress = config.delegationManagerAddress
  }

  /** Issue and sign a root delegation from delegator to delegate. */
  async issueDelegation(params: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    caveats: Caveat[]
    salt: bigint
  }): Promise<Delegation> {
    const delegation: Delegation = {
      delegator: params.delegator,
      delegate: params.delegate,
      authority: ROOT_AUTHORITY,
      caveats: params.caveats,
      salt: params.salt,
      signature: '0x',
    }

    // Get the delegation hash from the contract
    const hash = await this.publicClient.readContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'hashDelegation',
      args: [delegation],
    }) as `0x${string}`

    // Sign with the delegator's wallet
    const signature = await this.walletClient.signMessage({
      account: this.walletClient.account!,
      message: { raw: hash },
    })

    return { ...delegation, signature }
  }

  /** Redeem a delegation chain to execute a call. */
  async redeemDelegation(params: {
    delegations: Delegation[]
    target: `0x${string}`
    value: bigint
    data: `0x${string}`
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [params.delegations, params.target, params.value, params.data],
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
    })
  }

  /** Revoke a delegation by hash. */
  async revokeDelegation(delegationHash: `0x${string}`): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'revokeDelegation',
      args: [delegationHash],
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
    })
  }

  /** Check if a delegation has been revoked. */
  async isRevoked(delegationHash: `0x${string}`): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'isRevoked',
      args: [delegationHash],
    })) as boolean
  }
}

// ─── Caveat Builders ────────────────────────────────────────────────

/** Encode timestamp enforcer terms — valid within a time window. */
export function encodeTimestampTerms(validAfter: number, validUntil: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(validAfter), BigInt(validUntil)],
  )
}

/** Encode value enforcer terms — max ETH value per call. */
export function encodeValueTerms(maxValue: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }], [maxValue])
}

/** Encode allowed targets terms — restrict to specific contracts. */
export function encodeAllowedTargetsTerms(targets: `0x${string}`[]): `0x${string}` {
  return encodeAbiParameters([{ type: 'address[]' }], [targets])
}

/** Encode allowed methods terms — restrict to specific selectors. */
export function encodeAllowedMethodsTerms(selectors: `0x${string}`[]): `0x${string}` {
  return encodeAbiParameters([{ type: 'bytes4[]' }], [selectors])
}

/** Build a Caveat struct from an enforcer address and encoded terms.
 *  args defaults to '0x' (empty) — provided at redemption time by the redeemer. */
export function buildCaveat(enforcer: `0x${string}`, terms: `0x${string}`, args: `0x${string}` = '0x'): Caveat {
  return { enforcer, terms, args }
}

// ─── EIP-712 Delegation Hashing (matches DelegationManager contract) ─

const DELEGATION_TYPEHASH = keccak256(
  toBytes('Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)'),
)

const CAVEAT_TYPEHASH = keccak256(
  toBytes('Caveat(address enforcer,bytes terms)'),
)

const EIP712_DOMAIN_TYPEHASH = keccak256(
  toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
)

/**
 * Compute the EIP-712 domain separator for the DelegationManager contract.
 * Must match the contract's constructor exactly.
 */
export function delegationDomainSeparator(
  chainId: number,
  delegationManagerAddress: `0x${string}`,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [
        EIP712_DOMAIN_TYPEHASH,
        keccak256(toBytes('AgentDelegationManager')),
        keccak256(toBytes('1')),
        BigInt(chainId),
        delegationManagerAddress,
      ],
    ),
  )
}

/**
 * Hash an array of caveats using the same scheme as DelegationManager._hashCaveats().
 */
export function hashCaveats(caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>): `0x${string}` {
  if (caveats.length === 0) {
    return keccak256(encodePacked(['bytes32[]'], [[]]))
  }
  const hashes = caveats.map((c) =>
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }],
        [CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)],
      ),
    ),
  )
  return keccak256(encodePacked(hashes.map(() => 'bytes32' as const), hashes))
}

/**
 * Compute the full EIP-712 hash of a delegation, matching DelegationManager.hashDelegation().
 * This is the hash that gets signed by the delegator and verified by _validateSignature.
 */
export function hashDelegation(
  delegation: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
    salt: bigint | string
  },
  chainId: number,
  delegationManagerAddress: `0x${string}`,
): `0x${string}` {
  const caveatsHash = hashCaveats(delegation.caveats)
  const salt = typeof delegation.salt === 'string' ? BigInt(delegation.salt) : delegation.salt

  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
      [DELEGATION_TYPEHASH, delegation.delegator, delegation.delegate, delegation.authority, caveatsHash, salt],
    ),
  )

  const domainSep = delegationDomainSeparator(chainId, delegationManagerAddress)
  return keccak256(encodePacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSep, structHash]))
}

// ─── Caveat Term Decoders ──────────────────────────────────────────

/** Decode timestamp enforcer terms → { validAfter, validUntil } (unix seconds) */
export function decodeTimestampTerms(terms: `0x${string}`): { validAfter: number; validUntil: number } {
  const [validAfter, validUntil] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    terms,
  )
  return { validAfter: Number(validAfter), validUntil: Number(validUntil) }
}

/** Decode value enforcer terms → { maxValue } (wei) */
export function decodeValueTerms(terms: `0x${string}`): { maxValue: bigint } {
  const [maxValue] = decodeAbiParameters([{ type: 'uint256' }], terms)
  return { maxValue }
}

/** Decode allowed targets terms → { targets } */
export function decodeAllowedTargetsTerms(terms: `0x${string}`): { targets: `0x${string}`[] } {
  const [targets] = decodeAbiParameters([{ type: 'address[]' }], terms)
  return { targets: targets as `0x${string}`[] }
}

/** Decode allowed methods terms → { selectors } */
export function decodeAllowedMethodsTerms(terms: `0x${string}`): { selectors: `0x${string}`[] } {
  const [selectors] = decodeAbiParameters([{ type: 'bytes4[]' }], terms)
  return { selectors: selectors as `0x${string}`[] }
}

// ─── MCP Tool Scope Caveat (off-chain enforcer) ────────────────────

/**
 * Sentinel enforcer address for MCP tool scoping.
 * This is NOT an on-chain contract — it's validated by the MCP server.
 * Using a deterministic address derived from the concept name.
 */
export const MCP_TOOL_SCOPE_ENFORCER = keccak256(toBytes('urn:smart-agent:mcp-tool-scope')).slice(0, 42) as `0x${string}`

/** Encode MCP tool scope terms — list of allowed tool names */
export function encodeMcpToolScopeTerms(allowedTools: string[]): `0x${string}` {
  return encodeAbiParameters([{ type: 'string[]' }], [allowedTools])
}

/** Decode MCP tool scope terms → { allowedTools } */
export function decodeMcpToolScopeTerms(terms: `0x${string}`): { allowedTools: string[] } {
  const [tools] = decodeAbiParameters([{ type: 'string[]' }], terms)
  return { allowedTools: tools as string[] }
}

/** Build a caveat that restricts which MCP tools the session can call */
export function buildMcpToolScopeCaveat(allowedTools: string[]): Caveat {
  return buildCaveat(MCP_TOOL_SCOPE_ENFORCER, encodeMcpToolScopeTerms(allowedTools))
}
