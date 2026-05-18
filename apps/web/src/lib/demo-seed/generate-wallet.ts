/**
 * Generate a real keypair for a demo user and deploy + register their
 * smart account + person agent ON CHAIN AS THE USER — i.e. signing
 * ERC-4337 userOps with the user's OWN EOA, never with the deployer or
 * master signer.
 *
 * This is the seed-time twin of the production flow: in production, a
 * real user comes in via passkey or MetaMask, and their FIRST action
 * lands on chain as a userOp whose `sender` is their smart account,
 * signed by their wallet, and `msg.sender` at the resolver = the smart
 * account. The demo seed reproduces exactly that shape — the simulated
 * EOA stands in for what would otherwise be a passkey or MetaMask key.
 *
 * Two userOps land on chain per user:
 *
 *   1. From the user's smart account:
 *        executeBatch([
 *          resolver.register(self, …),
 *          resolver.setStringProperty(self, ATL_PRIMARY_NAME, "<slug>-sa.agent"),
 *        ])
 *
 *   2. From the user's person agent:
 *        executeBatch([
 *          resolver.register(self, …),
 *          resolver.addMultiAddressProperty(self, ATL_CONTROLLER, userEoa),
 *          resolver.setStringProperty(self, ATL_PRIMARY_NAME, "<slug>.agent"),
 *        ])
 *
 * In both cases the userOp's `initCode` counterfactually deploys the
 * account via `AgentAccountFactory.createAccount(userEoa, salt)`. The
 * deployer EOA acts purely as the EntryPoint relayer (handleOps gas
 * payer) — it does NOT sign or own these accounts.
 *
 * DEPLOY/SEED-TIME ONLY (K6). Invoked from the boot-seed driver
 * (`apps/web/src/lib/boot-seed.ts`) on fresh-start; never from a
 * request handler. Allowlisted in `scripts/check-no-bypass.sh`.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { parseEther } from 'viem'
import { keccak256, encodePacked, toBytes } from 'viem'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { ATL_CONTROLLER, ATL_PRIMARY_NAME } from '@smart-agent/sdk'
import {
  registerAgentAsSelf,
  getCounterfactualAddress,
} from './agent-self-register'

const TYPE_PERSON = keccak256(toBytes('atl:PersonAgent'))

/** Turn a display name like "Pastor David Chen" into a DNS-safe slug
 *  "pastor-david-chen" suitable as the leftmost label of a primary name.
 *  Falls back to a deterministic hash-derived slug when the input is
 *  empty or produces nothing legal after stripping. The A2A URL resolver
 *  derives the host slug from the leftmost label of `ATL_PRIMARY_NAME`,
 *  so this slug must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. */
function deriveSlug(name: string | undefined, agentAddress: `0x${string}`): string {
  const fromName = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  if (fromName) return fromName
  // Deterministic, address-derived fallback. Always shaped as a valid DNS label.
  return `agent-${agentAddress.slice(2, 10).toLowerCase()}`
}

/**
 * Generate a new wallet, fund it, deploy + register both the smart account
 * and the person agent — each via a userOp signed by the user's own EOA.
 */
export async function generateDemoWallet(userName?: string): Promise<{
  privateKey: `0x${string}`
  address: `0x${string}`
  smartAccountAddress: `0x${string}`
  personAgentAddress: `0x${string}`
}> {
  // 1. Generate keypair — this EOA is the user's "wallet" in the demo.
  //    It's the EOA that signs every userOp envelope for the user's smart
  //    account AND person agent. Master signer is a co-owner of both (via
  //    factory.serverSigner) but never signs user-initiated actions.
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)

  // 2. Fund from deployer (1 ETH). The userOps below pay gas via the
  //    paymaster + deployer-relayer, so the user EOA does NOT need ETH
  //    for the seed-time registers. BUT downstream seed flows (geo
  //    claims, name registry writes, edges) still sign with the deployer
  //    for now (they have different auth models — see report). We keep
  //    the funding here so the user EOA is ready to sign on-chain
  //    actions at runtime without a separate top-up.
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
  if (deployerKey) {
    const wc = getWalletClient()
    const pc = getPublicClient()
    const hash = await wc.sendTransaction({
      account: wc.account!,
      chain: wc.chain ?? null,
      to: account.address,
      value: parseEther('1'),
    })
    await pc.waitForTransactionReceipt({ hash })
  }

  // 3. Compute counterfactual addresses for BOTH accounts.
  //    Owner = user EOA in both cases. Person agent gets a deterministic
  //    salt derived from the user EOA so a re-run of the seed always
  //    finds the same person agent. The smart account uses a random
  //    salt (Date.now() + jitter) — the same shape as before, but with
  //    the user EOA as owner instead of the deployer.
  const acctSalt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
  const smartAccountAddress = await getCounterfactualAddress(account.address, acctSalt)

  const personSaltHash = keccak256(encodePacked(['string', 'address'], ['person', account.address]))
  const personSalt = BigInt(personSaltHash)
  const personAgentAddress = await getCounterfactualAddress(account.address, personSalt)

  // 4. Register the SMART ACCOUNT first.
  //    One batched userOp: register(self) + setStringProperty(ATL_PRIMARY_NAME).
  //    `initCode` deploys the account in the same op.
  const slug = deriveSlug(userName, personAgentAddress)
  const saSlug = `${slug}-sa`
  const saPrimaryName = `${saSlug}.agent`
  const paPrimaryName = `${slug}.agent`

  await registerAgentAsSelf({
    smartAccount: smartAccountAddress,
    signerAccount: account,
    salt: acctSalt,
    name: userName ?? 'Personal Account',
    description: '',
    agentType: TYPE_PERSON,
    properties: [
      { kind: 'string', predicate: ATL_PRIMARY_NAME as `0x${string}`, value: saPrimaryName },
    ],
    label: `smart-account[${userName ?? account.address}]`,
  })

  // 5. Register the PERSON AGENT.
  //    Same shape: one batched userOp deploys + registers + sets the
  //    controller + sets the primary name. ATL_CONTROLLER carries the
  //    user's EOA so KB sync / reverse-resolution can find the person
  //    agent from a wallet address (legacy behaviour preserved).
  await registerAgentAsSelf({
    smartAccount: personAgentAddress,
    signerAccount: account,
    salt: personSalt,
    name: userName ?? 'Personal Agent',
    description: '',
    agentType: TYPE_PERSON,
    properties: [
      { kind: 'multiAddress-append', predicate: ATL_CONTROLLER as `0x${string}`, value: account.address },
      { kind: 'string', predicate: ATL_PRIMARY_NAME as `0x${string}`, value: paPrimaryName },
    ],
    label: `person-agent[${userName ?? account.address}]`,
  })

  console.log(`[generate-wallet] Person agent registered: ${personAgentAddress} → ${account.address} (primary=${paPrimaryName})`)
  console.log(`[generate-wallet] Smart account registered: ${smartAccountAddress} → ${account.address} (primary=${saPrimaryName})`)

  return {
    privateKey,
    address: account.address,
    smartAccountAddress,
    personAgentAddress,
  }
}
