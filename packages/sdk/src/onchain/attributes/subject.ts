import { keccak256, pad, toHex, encodePacked, type Address, type Hex } from 'viem'

/**
 * Canonical subject id derivation for OntologyAttributeStore.
 *
 * Every caller MUST go through this helper — no ad-hoc keccak256 or pad calls.
 * The contract layer assumes these exact derivations:
 *   - agent / pool / fund: left-padded uint160 of the agent address
 *   - name node: passthrough (already a namehash)
 *   - round / proposal / match / pledge: keccak256(`sa:<class>:<id>`)
 */
export type SubjectDomain =
  | 'agent'
  | 'pool'
  | 'fund'
  | 'name'
  | 'round'
  | 'proposal'
  | 'match'
  | 'pledge'

/** Datatype discriminators — must match `OntologyAttributeStore.DT_*`. */
export const DT = {
  STRING: 1,
  ADDRESS: 2,
  BOOL: 3,
  UINT256: 4,
  BYTES32: 5,
  STRING_ARR: 6,
  ADDRESS_ARR: 7,
  BYTES32_ARR: 8,
} as const

export type Datatype = (typeof DT)[keyof typeof DT]

/** Subject id for an agent, pool, or fund (Pool/Fund are agents). */
export function agentSubject(addr: Address): Hex {
  return pad(addr, { size: 32 })
}

/** Subject id for a name node — passthrough (already a namehash). */
export function nameSubject(node: Hex): Hex {
  return node
}

/** Subject id for a round, derived from off-chain round id string. */
export function roundSubject(roundId: string): Hex {
  return keccak256(encodePacked(['string', 'string'], ['sa:round:', roundId]))
}

/** Subject id for a proposal, derived from off-chain proposal id string. */
export function proposalSubject(proposalId: string): Hex {
  return keccak256(encodePacked(['string', 'string'], ['sa:proposal:', proposalId]))
}

/** Subject id for a match initiation, derived from off-chain match id string. */
export function matchSubject(matchId: string): Hex {
  return keccak256(encodePacked(['string', 'string'], ['sa:match:', matchId]))
}

/** Subject id for a pledge, derived from off-chain pledge id string. */
export function pledgeSubject(pledgeId: string): Hex {
  return keccak256(encodePacked(['string', 'string'], ['sa:pledge:', pledgeId]))
}

/**
 * Single-entry helper. Use this instead of inlining the per-domain calls when
 * the domain is dynamic.
 */
export function subjectId(domain: SubjectDomain, value: string): Hex {
  switch (domain) {
    case 'agent':
    case 'pool':
    case 'fund':
      return agentSubject(value as Address)
    case 'name':
      return nameSubject(value as Hex)
    case 'round':
      return roundSubject(value)
    case 'proposal':
      return proposalSubject(value)
    case 'match':
      return matchSubject(value)
    case 'pledge':
      return pledgeSubject(value)
  }
}

/** Hash a CURIE to its predicate id (matches `keccak256(bytes(curie))`). */
export function predicateId(curie: string): Hex {
  return keccak256(toHex(curie))
}
