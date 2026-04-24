/**
 * On-chain resolver (cheqd-style).
 *
 * The CredentialRegistry contract emits SchemaPublished / CredDefPublished
 * events with canonical-JSON payloads in the non-indexed event data. A
 * verifier with only RPC access can recover the full record, verify
 * keccak(canonicalJson) against the indexed jsonHash, and trust
 * msg.sender (the event's indexed `issuer` topic) as provenance.
 *
 * No SQLite. No off-chain registry. No issuer in the verification path.
 */

import {
  createPublicClient,
  http,
  keccak256,
  toBytes,
  toHex,
  getAddress,
  stringToHex,
  type Address,
  type PublicClient,
  type Chain,
  type Log,
} from 'viem'

import type {
  SchemaRecord,
  CredentialDefinitionRecord,
  IssuerRecord,
} from './types'

export const credentialRegistryAbi = [
  {
    type: 'function', name: 'registerIssuer', stateMutability: 'nonpayable',
    inputs: [{ name: 'did', type: 'string' }, { name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'publishSchema', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'string' }, { name: 'canonicalJson', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function', name: 'publishCredDef', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'string' },
      { name: 'schemaId', type: 'string' },
      { name: 'canonicalJson', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getIssuer', stateMutability: 'view',
    inputs: [{ name: 'did', type: 'string' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'did', type: 'string' },
      { name: 'account', type: 'address' },
      { name: 'registeredAt', type: 'uint64' },
    ] }],
  },
  {
    type: 'function', name: 'getIssuerByAddress', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'did', type: 'string' },
      { name: 'account', type: 'address' },
      { name: 'registeredAt', type: 'uint64' },
    ] }],
  },
  {
    type: 'function', name: 'isSchemaPublished', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }], outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'isCredDefPublished', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }], outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'schemaJsonHash', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }], outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'credDefJsonHash', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }], outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'schemaIssuerOf', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }], outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'credDefIssuerOf', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }], outputs: [{ type: 'address' }],
  },
  {
    type: 'event', name: 'IssuerRegistered', anonymous: false,
    inputs: [
      { name: 'did', type: 'string', indexed: false },
      { name: 'account', type: 'address', indexed: true },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'SchemaPublished', anonymous: false,
    inputs: [
      { name: 'schemaIdKey', type: 'bytes32', indexed: true },
      { name: 'jsonHash', type: 'bytes32', indexed: true },
      { name: 'issuer', type: 'address', indexed: true },
      { name: 'id', type: 'string', indexed: false },
      { name: 'canonicalJson', type: 'bytes', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'CredDefPublished', anonymous: false,
    inputs: [
      { name: 'credDefIdKey', type: 'bytes32', indexed: true },
      { name: 'jsonHash', type: 'bytes32', indexed: true },
      { name: 'issuer', type: 'address', indexed: true },
      { name: 'id', type: 'string', indexed: false },
      { name: 'schemaId', type: 'string', indexed: false },
      { name: 'canonicalJson', type: 'bytes', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
] as const

export interface OnChainResolverConfig {
  rpcUrl: string
  chain?: Chain
  chainId: number
  contractAddress: Address
  /** Earliest block to scan when searching for a publish event. 0 is fine for anvil. */
  fromBlock?: bigint
}

/** Keccak-256 of the id bytes — matches the indexed topic in the contract. */
function idKey(id: string): `0x${string}` {
  return keccak256(stringToHex(id))
}

export class OnChainResolver {
  private readonly client: PublicClient
  private readonly schemaCache = new Map<string, SchemaRecord>()
  private readonly credDefCache = new Map<string, CredentialDefinitionRecord>()
  private readonly issuerByAddressCache = new Map<string, IssuerRecord>()

  constructor(private readonly cfg: OnChainResolverConfig) {
    this.client = createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    })
  }

  /** The chain id this resolver points at (used to build did:evm URIs). */
  get chainId(): number {
    return this.cfg.chainId
  }

  /** The contract address this resolver reads (used in did:evm URIs). */
  get contractAddress(): Address {
    return this.cfg.contractAddress
  }

  private async publicClient(): Promise<PublicClient> {
    return this.client
  }

  /** Resolve a schema by canonical id. Throws if not published. */
  async resolveSchema(id: string): Promise<SchemaRecord> {
    const cached = this.schemaCache.get(id)
    if (cached) return cached

    const client = await this.publicClient()
    const key = idKey(id)
    const logs = await client.getLogs({
      address: this.cfg.contractAddress,
      event: schemaPublishedEvent,
      args: { schemaIdKey: key },
      fromBlock: this.cfg.fromBlock ?? 0n,
      toBlock: 'latest',
    })
    if (logs.length === 0) throw new Error(`schema not published on chain: ${id}`)
    // Contract enforces one-publish-per-id so any match works; pick the first.
    const log = logs[0]
    const rec = await this.recordFromSchemaLog(log, id)
    this.schemaCache.set(id, rec)
    return rec
  }

  /** Resolve a credential definition by canonical id. Throws if not published. */
  async resolveCredDef(id: string): Promise<CredentialDefinitionRecord> {
    const cached = this.credDefCache.get(id)
    if (cached) return cached

    const client = await this.publicClient()
    const key = idKey(id)
    const logs = await client.getLogs({
      address: this.cfg.contractAddress,
      event: credDefPublishedEvent,
      args: { credDefIdKey: key },
      fromBlock: this.cfg.fromBlock ?? 0n,
      toBlock: 'latest',
    })
    if (logs.length === 0) throw new Error(`credDef not published on chain: ${id}`)
    const log = logs[0]
    const rec = await this.recordFromCredDefLog(log, id)
    this.credDefCache.set(id, rec)
    return rec
  }

  /** Resolve an issuer registration by EOA. Returns null if unregistered. */
  async resolveIssuer(account: Address): Promise<IssuerRecord | null> {
    const normalised = getAddress(account)
    const cached = this.issuerByAddressCache.get(normalised.toLowerCase())
    if (cached) return cached
    const r = await this.client.readContract({
      address: this.cfg.contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'getIssuerByAddress',
      args: [normalised],
    }) as { did: string; account: Address; registeredAt: bigint }
    if (r.account === '0x0000000000000000000000000000000000000000') return null
    const rec: IssuerRecord = {
      did: r.did,
      address: normalised,
      registeredAt: new Date(Number(r.registeredAt) * 1000),
    }
    this.issuerByAddressCache.set(normalised.toLowerCase(), rec)
    return rec
  }

  /** True iff the schema is published on chain. Cheap sentinel — no log fetch. */
  async isSchemaPublished(id: string): Promise<boolean> {
    if (this.schemaCache.has(id)) return true
    return (await this.client.readContract({
      address: this.cfg.contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'isSchemaPublished',
      args: [id],
    })) as boolean
  }

  async isCredDefPublished(id: string): Promise<boolean> {
    if (this.credDefCache.has(id)) return true
    return (await this.client.readContract({
      address: this.cfg.contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'isCredDefPublished',
      args: [id],
    })) as boolean
  }

  private async recordFromSchemaLog(
    log: Log<bigint, number, false, typeof schemaPublishedEvent>,
    expectedId: string,
  ): Promise<SchemaRecord> {
    const args = log.args as {
      schemaIdKey?: `0x${string}`
      jsonHash?: `0x${string}`
      issuer?: `0x${string}`
      id?: string
      canonicalJson?: `0x${string}`
      at?: bigint
    } | undefined
    if (!args || !args.id || !args.canonicalJson || !args.jsonHash || !args.issuer) {
      throw new Error(`SchemaPublished log missing decoded args for ${expectedId}`)
    }
    const { id, canonicalJson, jsonHash, issuer } = args
    if (id !== expectedId) throw new Error(`SchemaPublished id mismatch: expected ${expectedId} got ${id}`)
    const recomputed = keccak256(canonicalJson)
    if (recomputed.toLowerCase() !== jsonHash.toLowerCase()) {
      throw new Error(`schema jsonHash mismatch: recomputed ${recomputed} expected ${jsonHash}`)
    }
    const block = await this.client.getBlock({ blockNumber: log.blockNumber })
    const issuerAddr = getAddress(issuer)
    return {
      id,
      issuerId: didEthrFor(this.cfg.chainId, issuerAddr),
      issuerAddress: issuerAddr,
      json: bytesToUtf8(canonicalJson),
      jsonHash,
      blockNumber: log.blockNumber,
      publishedAt: new Date(Number(block.timestamp) * 1000),
    }
  }

  private async recordFromCredDefLog(
    log: Log<bigint, number, false, typeof credDefPublishedEvent>,
    expectedId: string,
  ): Promise<CredentialDefinitionRecord> {
    const args = log.args as {
      credDefIdKey?: `0x${string}`
      jsonHash?: `0x${string}`
      issuer?: `0x${string}`
      id?: string
      schemaId?: string
      canonicalJson?: `0x${string}`
      at?: bigint
    } | undefined
    if (!args || !args.id || !args.schemaId || !args.canonicalJson || !args.jsonHash || !args.issuer) {
      throw new Error(`CredDefPublished log missing decoded args for ${expectedId}`)
    }
    const { id, schemaId, canonicalJson, jsonHash, issuer } = args
    if (id !== expectedId) throw new Error(`CredDefPublished id mismatch: expected ${expectedId} got ${id}`)
    const recomputed = keccak256(canonicalJson)
    if (recomputed.toLowerCase() !== jsonHash.toLowerCase()) {
      throw new Error(`credDef jsonHash mismatch: recomputed ${recomputed} expected ${jsonHash}`)
    }
    const block = await this.client.getBlock({ blockNumber: log.blockNumber })
    const issuerAddr = getAddress(issuer)
    return {
      id,
      schemaId,
      issuerId: didEthrFor(this.cfg.chainId, issuerAddr),
      issuerAddress: issuerAddr,
      json: bytesToUtf8(canonicalJson),
      jsonHash,
      blockNumber: log.blockNumber,
      publishedAt: new Date(Number(block.timestamp) * 1000),
    }
  }

  /** Drop all cached records (useful for tests). */
  invalidate(): void {
    this.schemaCache.clear()
    this.credDefCache.clear()
    this.issuerByAddressCache.clear()
  }
}

export function didEthrFor(chainId: number, account: Address): string {
  return `did:ethr:${chainId}:${account.toLowerCase()}`
}

function bytesToUtf8(bytes: `0x${string}`): string {
  // viem-style 0x-prefixed bytes of UTF-8 JSON.
  const hex = bytes.startsWith('0x') ? bytes.slice(2) : bytes
  const buf = Buffer.from(hex, 'hex')
  return buf.toString('utf8')
}

/** Re-declared here so eth_getLogs can match by topic shape. */
const schemaPublishedEvent = {
  type: 'event', name: 'SchemaPublished', anonymous: false,
  inputs: [
    { name: 'schemaIdKey', type: 'bytes32', indexed: true },
    { name: 'jsonHash', type: 'bytes32', indexed: true },
    { name: 'issuer', type: 'address', indexed: true },
    { name: 'id', type: 'string', indexed: false },
    { name: 'canonicalJson', type: 'bytes', indexed: false },
    { name: 'at', type: 'uint64', indexed: false },
  ],
} as const

const credDefPublishedEvent = {
  type: 'event', name: 'CredDefPublished', anonymous: false,
  inputs: [
    { name: 'credDefIdKey', type: 'bytes32', indexed: true },
    { name: 'jsonHash', type: 'bytes32', indexed: true },
    { name: 'issuer', type: 'address', indexed: true },
    { name: 'id', type: 'string', indexed: false },
    { name: 'schemaId', type: 'string', indexed: false },
    { name: 'canonicalJson', type: 'bytes', indexed: false },
    { name: 'at', type: 'uint64', indexed: false },
  ],
} as const

// Re-export for consumers that want to keccak an id themselves.
export { idKey }

/** Keccak of canonical JSON bytes. Helper mirrored for issuer-side use. */
export function canonicalJsonHash(json: string): `0x${string}` {
  return keccak256(toBytes(json))
}

export const SCHEMA_PUBLISHED_EVENT = schemaPublishedEvent
export const CRED_DEF_PUBLISHED_EVENT = credDefPublishedEvent

// Re-exported so callers don't need a separate viem import for common encodings.
export { stringToHex, toHex, toBytes, keccak256 }
