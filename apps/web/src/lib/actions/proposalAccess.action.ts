'use server'

/**
 * Spec 003 (Proposal Lane) — Stranger-applies-to-round access gateway.
 *
 * When a stranger (not the round operator) clicks "Apply to a round", they
 * do not yet hold a `ProposalSubmitterCredential` for that pool, so the
 * AnonCreds-gated submit path bounces off the pres-builder with "no held
 * credential". A self-issued cred won't satisfy the on-chain
 * `GrantProposalRegistry.submit` modifier `onlyRoundOperator(roundSubject)`:
 * that modifier checks
 *
 *   _isAccountOwner(fundAgent, msg.sender)   // i.e. fundAgent.isOwner(msg.sender)
 *
 * which only passes if `msg.sender` is in `fundAgent._owners`. The stranger
 * is not.
 *
 * The operator IS. Specifically the pool's initial-owner relationship —
 * for UI-created pools (`pool:create` MCP tool) the initial owner is
 * `orgPrincipal` = the operator's smart account; for the seed-grant-flow
 * script the pool's owners are `mariaEoa` + `maria.personAgent`. Either
 * way, the operator's smart account is `_owners[…] == true` on the fund
 * agent.
 *
 * So this gateway:
 *
 *   1. Resolves the round → its fund agent (on-chain).
 *   2. Locates the operator user — a `local_user_accounts` row whose
 *      smart account / personAgent is in `fundAgent._owners` AND has a
 *      stored `privateKey`. (Demo users have `privateKey`; real
 *      passkey/SIWE users do not — TODO at bottom.)
 *   3. Issues a fresh `ProposalSubmitterCredential` to the stranger with
 *      an admin → holder root delegation:
 *        delegator = operator.ownerAddress (one of {SA, personAgent}
 *                    confirmed to be in fundAgent._owners)
 *        delegate  = stranger's smart account
 *        signature = signed by the operator's EOA (`local_user_accounts.privateKey`).
 *
 *   DM validates the admin delegation by calling
 *   `operator.ownerAddress.isValidSignature(hash, sig)` — ERC-1271 on
 *   the operator's AgentAccount recovers the operator's EOA and checks
 *   the SA's `_owners` (true: boot-seed sets the EOA as the initial
 *   owner of the user's own smart account / personAgent).
 *
 *   Redemption then dispatches through
 *   `operator.ownerAddress.execute(GrantProposalRegistry, …)`, so
 *   `msg.sender` at the registry equals `operator.ownerAddress` —
 *   which is in `fundAgent._owners`, so the on-chain
 *   `onlyRoundOperator` modifier passes.
 *
 * Gates:
 *   - Round must be public (private rounds enforce a separate addressed-
 *     applicants list and never want a stranger applying).
 *   - Round.deadline must not have passed.
 *
 * Real-user (non-demo) operators: the operator's `privateKey` is null in
 * `local_user_accounts`. We DO NOT fall back to the deployer key, and we
 * DO NOT bypass the gate. Instead we return a clear failure so the UI
 * can route the stranger to an explicit invitation flow. See TODO at
 * bottom for the real-user path.
 */

import 'server-only'
import type { Address, Hex } from 'viem'
import { getAddress, keccak256, toHex } from 'viem'
import { hubGetRoundDetail } from '@/lib/clients/hub-client'
import { db, schema } from '@/db'
import { sql } from 'drizzle-orm'
import { getPublicClient } from '@/lib/contracts'
import { agentAccountAbi, fundRegistryAbi } from '@smart-agent/sdk'

export interface RequestProposalAccessInput {
  /** The round the stranger is applying to. URN (`urn:smart-agent:round:<slug>`)
   *  or bare slug — both forms accepted. */
  roundId: string
  /** The stranger's smart account (delegate of the admin → holder
   *  delegation; their person-mcp will store the new credential). */
  holderSmartAccount: Address
  /** The stranger's EOA private key. Used to (a) provision their holder
   *  wallet and (b) sign the AcceptCredentialOffer WalletAction during
   *  AnonCreds issuance. MUST be an owner of `holderSmartAccount` so
   *  ERC-1271 accepts the holder-side signatures. Demo users' value
   *  comes from `local_user_accounts.privateKey`. */
  holderPrivateKey: Hex
  /** The stranger's person-mcp principal (e.g. `person_<userId>` for demo
   *  users, `person_<smartAccount>` for passkey/SIWE). Drives where the
   *  fresh credential row lands. */
  holderPrincipal: string
}

export type RequestProposalAccessResult =
  | { ok: true; credentialId: string }
  | { ok: false; error: string }

/**
 * Issue a `ProposalSubmitterCredential` to `holderSmartAccount` for the
 * round's pool, with the admin → holder root delegation rooted at the
 * round operator's smart account.
 */
export async function requestProposalAccess(
  input: RequestProposalAccessInput,
): Promise<RequestProposalAccessResult> {
  // 1. Resolve the round body via Discovery for visibility + deadline.
  //    Discovery (GraphDB mirror) is best-effort — fresh rounds may not
  //    have synced yet; in that case we fall through to the chain lookup
  //    for fundAgent and let the on-chain checks downstream catch any
  //    misalignment.
  let round
  try {
    round = await hubGetRoundDetail(input.roundId, null)
  } catch (e) {
    return { ok: false, error: `hub-mcp round detail: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (round) {
    if (round.visibility !== 'public') {
      return { ok: false, error: 'round is not public — strangers can only auto-request access to public rounds' }
    }
    if (round.deadline) {
      const deadlineMs = Date.parse(round.deadline)
      if (Number.isFinite(deadlineMs) && deadlineMs < Date.now()) {
        return { ok: false, error: `round submission deadline has passed (${round.deadline})` }
      }
    }
  }

  // 2. Resolve fundAgent from FundRegistry directly (authoritative; survives
  //    GraphDB lag). Slug derivation matches FundRegistry.roundSubject:
  //    keccak256(abi.encodePacked("sa:round:", slug)).
  const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!fundRegistry) {
    return { ok: false, error: 'FUND_REGISTRY_ADDRESS not set' }
  }
  const slug = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId.slice('urn:smart-agent:round:'.length)
    : input.roundId
  const roundSubject = keccak256(toHex(`sa:round:${slug}`))
  let fundAgent: Address
  try {
    const pub = getPublicClient()
    const onChainFund = (await pub.readContract({
      address: fundRegistry,
      abi: fundRegistryAbi,
      functionName: 'getRoundFundAgent',
      args: [roundSubject],
    })) as Address
    if (!onChainFund || onChainFund === '0x0000000000000000000000000000000000000000') {
      return { ok: false, error: `round not bound to a fund on chain (subject=${roundSubject})` }
    }
    fundAgent = getAddress(onChainFund)
  } catch (e) {
    return { ok: false, error: `fundAgent lookup failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 3. Find the round operator's user row + the operator-side smart
  //    account that's actually in `fundAgent._owners`. The UI's
  //    pool-create flow makes the operator's smart account the pool's
  //    initial owner; the seed-grant-flow script makes `personAgent` an
  //    owner via `addOwner`. We probe both and use whichever matches.
  //
  //    The matched owner address becomes the admin delegation's
  //    delegator — and thus `msg.sender` at the registry — so
  //    `_isAccountOwner(fundAgent, msg.sender)` will be true by
  //    construction.
  let operator: {
    id: string
    privateKey: string
    ownerAddress: Address
  } | undefined
  try {
    const candidates = await db
      .select()
      .from(schema.localUserAccounts)
      .where(sql`${schema.localUserAccounts.privateKey} IS NOT NULL`)
    const pub = getPublicClient()
    for (const c of candidates) {
      if (!c.privateKey) continue
      // The matched address MUST be a smart account (not the bare EOA) so
      // DM's ERC-1271 path can recover the signing EOA and check
      // `_owners` on it. We probe smartAccount first (UI-created pool
      // owner pattern), then personAgent (script-seed pattern).
      const probes: Address[] = []
      if (c.smartAccountAddress) probes.push(c.smartAccountAddress as Address)
      if (c.personAgentAddress) probes.push(c.personAgentAddress as Address)
      let matched: Address | undefined
      for (const p of probes) {
        try {
          const result = (await pub.readContract({
            address: fundAgent,
            abi: agentAccountAbi,
            functionName: 'isOwner',
            args: [p],
          })) as boolean
          if (result) { matched = p; break }
        } catch {
          // fundAgent may not be a deployed AgentAccount, or probe
          // address might be malformed — try the next candidate.
        }
      }
      if (matched) {
        operator = {
          id: c.id,
          privateKey: c.privateKey,
          ownerAddress: matched,
        }
        break
      }
    }
  } catch (e) {
    return { ok: false, error: `operator lookup failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!operator) {
    return {
      ok: false,
      // TODO: implement signed access-grant for real (non-demo) operators.
      // See bottom-of-file note.
      error:
        'operator key not available — real-user flow requires a pre-authorized invitation. '
        + 'TODO: implement signed access-grant for non-demo operators.',
    }
  }

  // 4. Issue the credential. (See file-header for the full chain-of-trust
  //    explanation.)
  const { issueMarketplaceCredential } = await import('@/lib/spec004/self-issue')
  const result = await issueMarketplaceCredential({
    adminSmartAccount: operator.ownerAddress,
    adminSigningKey: operator.privateKey as Hex,
    holderSmartAccount: input.holderSmartAccount,
    holderSigningKey: input.holderPrivateKey,
    credentialType: 'ProposalSubmitterCredential',
    poolAgentId: fundAgent, // bound to the pool/fund for AnonCreds expectedAttributes
    holderPrincipalOverride: input.holderPrincipal,
  })
  if (!result.ok) {
    return { ok: false, error: `issuance failed: ${result.error}` }
  }
  return { ok: true, credentialId: result.credentialId }
}

// ─── TODO ─────────────────────────────────────────────────────────────
// Real-user (non-demo) operators do not store their private key on the
// server. The honest path is:
//
//   1. Operator pre-authorizes a signed `AccessGrant` for the pool —
//      either via a passkey-signed WalletAction stored on their org-mcp,
//      or an on-chain `ProposalAccessRegistry` that the operator writes
//      to via their normal session.
//   2. `requestProposalAccess` checks for an active grant matching the
//      stranger + pool, then issues the credential on the operator's
//      authority without needing their raw key (server signs as a
//      delegated issuer, or the operator's pre-signed delegation is
//      reused as the admin→holder root).
//
// Until that flow exists we surface a clear error rather than fall back
// to the deployer key (which would silently violate substrate
// independence P1).
