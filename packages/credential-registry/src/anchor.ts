/**
 * On-chain anchor verification (Phase 6).
 *
 * Reads the CredentialRegistry contract and confirms that the keccak256 of
 * the canonical record JSON matches the hash anchored on-chain by the
 * issuer. Must pair with the off-chain signature check — see verify.ts.
 */

import { createPublicClient, http, keccak256, toBytes, type Address, type PublicClient, type Chain } from 'viem'
import { canonicalJson, recordDigest } from './signing'

export const credentialRegistryAbi = [
  { type: 'function', name: 'getIssuer',            stateMutability: 'view', inputs: [{ name: 'did', type: 'string' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'did', type: 'string' },
      { name: 'account', type: 'address' },
      { name: 'registeredAt', type: 'uint64' },
    ] }] },
  { type: 'function', name: 'getSchemaAnchor',      stateMutability: 'view', inputs: [{ name: 'id', type: 'string' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'id', type: 'string' },
      { name: 'recordHash', type: 'bytes32' },
      { name: 'issuer', type: 'address' },
      { name: 'anchoredAt', type: 'uint64' },
    ] }] },
  { type: 'function', name: 'getCredDefAnchor',     stateMutability: 'view', inputs: [{ name: 'id', type: 'string' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'id', type: 'string' },
      { name: 'recordHash', type: 'bytes32' },
      { name: 'schemaId', type: 'string' },
      { name: 'issuer', type: 'address' },
      { name: 'anchoredAt', type: 'uint64' },
    ] }] },
  { type: 'function', name: 'isSchemaAnchored',     stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }, { name: 'expectedHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isCredDefAnchored',    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'string' }, { name: 'expectedHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'registerIssuer',       stateMutability: 'nonpayable',
    inputs: [{ name: 'did', type: 'string' }, { name: 'account', type: 'address' }],
    outputs: [] },
  { type: 'function', name: 'anchorSchema',         stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'string' }, { name: 'recordHash', type: 'bytes32' }],
    outputs: [] },
  { type: 'function', name: 'anchorCredDef',        stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'string' }, { name: 'recordHash', type: 'bytes32' }, { name: 'schemaId', type: 'string' }],
    outputs: [] },
] as const

export interface AnchorCheckerConfig {
  rpcUrl: string
  chain?: Chain
  contractAddress: Address
  /** If true, missing-anchor also fails. Default: true. */
  strict?: boolean
}

export class AnchorChecker {
  private readonly client: PublicClient
  constructor(private readonly cfg: AnchorCheckerConfig) {
    this.client = createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    })
  }

  /** Verify `schemaJson` matches the hash anchored under `id`. */
  async verifySchema(id: string, schemaJson: string): Promise<boolean> {
    const expected = recordDigest('schema', id, schemaJson)
    try {
      const ok = (await this.client.readContract({
        address: this.cfg.contractAddress,
        abi: credentialRegistryAbi,
        functionName: 'isSchemaAnchored',
        args: [id, expected],
      })) as boolean
      return ok
    } catch (err) {
      if (this.cfg.strict === false) return false
      throw err
    }
  }

  async verifyCredDef(id: string, credDefJson: string): Promise<boolean> {
    const expected = recordDigest('credDef', id, credDefJson)
    try {
      const ok = (await this.client.readContract({
        address: this.cfg.contractAddress,
        abi: credentialRegistryAbi,
        functionName: 'isCredDefAnchored',
        args: [id, expected],
      })) as boolean
      return ok
    } catch (err) {
      if (this.cfg.strict === false) return false
      throw err
    }
  }

  /** Lookup issuer record via DID. */
  async getIssuer(did: string): Promise<{ did: string; account: Address; registeredAt: bigint } | null> {
    const r = (await this.client.readContract({
      address: this.cfg.contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'getIssuer',
      args: [did],
    })) as { did: string; account: Address; registeredAt: bigint }
    if (r.account === '0x0000000000000000000000000000000000000000') return null
    return r
  }
}

/** Parse a did:ethr into its address component. */
export function didEthrToAddressStrict(did: string): Address {
  const m = did.match(/^did:ethr(?::[^:]+)?:(0x[0-9a-fA-F]{40})$/)
  if (!m) throw new Error(`not a did:ethr: ${did}`)
  return m[1] as Address
}

/** Keccak of (type||id||json) to feed on-chain anchors. Re-exported for callers. */
export function anchorHash(type: 'schema' | 'credDef', id: string, json: string): `0x${string}` {
  return keccak256(toBytes(canonicalJson({ type, id, json })))
}
