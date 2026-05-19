# K5 — Key Escrow and Account Loss Recovery

> **Status**: DRAFT. **Today there is NO key escrow.** The good news,
> post-Phase A: master-key loss does NOT brick user accounts. The bad
> news: bundler / sessionIssuer loss DOES brick user-action throughput
> until the role-registry mitigation lands (Phase A.1). Upgrade-authority
> loss is the highest-blast-radius scenario; this doc proposes the
> multisig design that closes it.

## 1. Scope

Disaster scenarios where the recovery procedure goes beyond rotation:

| # | Scenario | Probability | Pre-Phase-A blast radius | Post-Phase-A blast radius |
|---|---|---|---|---|
| S1 | **AWS root account compromised**; attacker has full IAM control. | Very low (<0.1%) but catastrophic. | Total system takeover via master being co-owner of every account; attacker mints malicious upgrades. | Limited: attacker can spoof MAC + relay tx envelopes but CANNOT author userOps (user inner sig required). Cannot upgrade accounts (owner sig required). Operational disruption (drain via fees, denial-of-service via mempool stuffing) but NOT key theft. |
| S2 | **AWS account terminated** (billing dispute, ToS action, support error). | Very low. | All in-account KMS gone; existing user accounts inaccessible because no master signer exists to relay userOps. | Same — relay path is down. User accounts and on-chain funds are still owned by user EOAs/passkeys and theoretically recoverable via a user signing directly (bypass relay), but that requires a UX path that does not exist today (user signs a userOp + submits via public bundler). |
| S3 | **GCP project deleted** (similar to S2 but worse — project deletion has a 30-day grace period; account termination has none). | Very low. | Same. | Same. |
| S4 | **Key material lost** (e.g., KMS key destroyed in error; envelope KEK destroyed while ciphertexts still exist). | Low but real (operator error). | Encrypted session data is unrecoverable. | Same — session data is gone but on-chain state is unaffected. |
| S5 | **Bundler / sessionIssuer KMS keys lost** (suspended IAM, mistaken `kms:ScheduleKeyDeletion` that elapsed). | Low. | n/a (these keys did not exist pre-Phase A). | userOps cannot be submitted via `executeFromBundler`; user-action throughput is zero. Existing on-chain state is preserved. |
| S6 | **Upgrade authority key lost** (the multisig that controls AgentAccountFactory / DelegationManager upgrades). | Very low if properly distributed. | n/a (no upgrade-authority key exists today; upgrades are owner-authorised per Phase A). | n/a unless we introduce a RoleRegistry admin (Phase A.1) and lose the multisig that controls it. THE high-stakes recovery scenario. |

The Phase A re-architecture FUNDAMENTALLY REDUCES blast radius for
S1–S4 because master is no longer a co-owner of user accounts. This is
THE security win of Phase A and the reason the senior architecture
review flagged the pre-Phase-A state as a P0.

---

## 2. Why master-key loss is recoverable (post-Phase A — good news)

### 2.1 What master does post-Phase-A

| Operation | Pre-Phase-A | Post-Phase-A |
|---|---|---|
| Sign user userOps | Yes (co-owner) — could sign for ANY user. | NO — `_owners` does not include master. |
| Authorize account upgrades | Yes (`onlySelf` via co-ownership). | NO — `upgradeToWithAuthorization` requires an actual owner sig. |
| Sign inter-service MAC | Yes. | Yes (unchanged). |
| Sign envelope-encrypt session data | Yes (via the envelope KEK). | Yes (unchanged). |
| Pay gas for `EntryPoint.handleOps` relay tx | Yes. | Yes (unchanged; this is the EOA-level signing for the relay tx itself, NOT for the inner userOp signature). |

### 2.2 What happens when master is lost

- **Inter-service MAC**: dies. Every cross-service request fails its
  inbound MAC check. System is operationally down until a new master
  is provisioned + propagated.
- **Envelope encryption**: every existing session row in the database
  becomes UNDECRYPTABLE (the envelope KEK is gone). Users with active
  sessions are logged out; they re-authenticate.
- **Relay tx**: cannot submit `handleOps`. **BUT** the userOp itself is
  signed by the user (passkey / EOA); a determined user could submit
  their own userOp directly via a public bundler endpoint or via
  `EntryPoint.handleOps` from any address. The user-action throughput
  is degraded (UX requires an alternate submission path), not zero.
- **On-chain authority**: UNAFFECTED. User EOAs / passkeys still own
  their accounts. Funds are not at risk.

### 2.3 Recovery for master loss

| Step | Action |
|---|---|
| 1 | Provision a new master KMS key (per provisioning runbook). |
| 2 | Re-deploy services with the new master env vars. |
| 3 | Re-issue inter-service MACs from the new master; per-service trust list update is required if multi-kid trust is implemented (K1-Q2); otherwise this is a planned-outage event. |
| 4 | Provision a new envelope KEK; existing session rows are TOMBSTONED (the encryptedDataKey column refers to a key that no longer exists). Operationally: drop the session table or accept that all sessions are invalid; users re-authenticate. |
| 5 | Audit-chain continues — the chain links via hashes, not via KMS keys; loss of master does not break the audit chain's integrity. |

**Expected user impact**: forced re-login on every active session.
That's it. No fund loss. No account loss.

This is the SINGLE BIGGEST OPERATIONAL WIN of Phase A and the board
should understand it: **a master-key compromise pre-Phase-A is
existential; post-Phase-A it's an annoyance.**

---

## 3. Bundler / sessionIssuer loss — partial-functionality scenario

### 3.1 Bundler loss

- Smart accounts continue to exist on chain; users still own them.
- userOps cannot be submitted via `executeFromBundler` (the function
  requires the bundlerSig to recover to `_bundlerSigner`, which is
  immutable per-account).
- Workaround: any USER can submit their own userOp to
  `EntryPoint.handleOps` directly — `executeFromBundler` is our
  defense-in-depth wrapper, not the only path. The standard ERC-4337
  validateUserOp path still works. UX is degraded (the user pays gas in
  ETH instead of being sponsored by our paymaster), but funds and
  operations are preserved.

> **Re-read this carefully**: Phase A § D3 specifies that the bundler
> envelope check happens at BOTH the pre-EntryPoint relay tx
> (off-chain, in a2a-agent) AND inside the contract
> (`executeFromBundler`). If the bundler key is lost, the off-chain
> relay path cannot construct a valid envelope, but the on-chain
> `validateUserOp` path itself does NOT require the bundler signature
> — it requires the user's inner signature. Therefore, in principle, a
> user with a self-funded EOA and a willingness to submit their own
> `handleOps` can still drive their account.
>
> Caveat: this depends on the exact contract shape of
> `executeFromBundler`. If it is the ONLY entry into account execution
> (no other `execute` path), then bundler-key loss IS account-bricking.
> Phase A § D3 says executeFromBundler is "an ADDITIONAL layer", which
> implies the standard validateUserOp path remains usable. THIS MUST
> BE VERIFIED at Phase A acceptance — if validateUserOp can drive
> execution without an executeFromBundler envelope check, then we have
> a viable recovery path. If executeFromBundler is the only entry
> point, then bundler loss is more serious. **OPEN K5-Q1.**

### 3.2 SessionIssuer loss

- Variant A sessions are UNAFFECTED — they redeem via
  `DelegationManager.redeemDelegation`, not via `acceptSessionDelegation`.
- Variant B sessions cannot be MINTED — `acceptSessionDelegation`
  requires sessionIssuerSig recovers to `_sessionIssuer`, which is
  immutable per-account.
- Existing Variant B sessions continue to function until their
  validUntil expires; they are not invalidated by the loss of the
  issuer key.
- **Net effect**: Variant B session creation is broken; everything else
  works. Variant A is the dominant lane per Phase A's risk-tier
  routing.

### 3.3 Recovery (BOTH bundler and sessionIssuer)

| Path | Description | Effort |
|---|---|---|
| **(a) Factory redeploy** | Deploy a new `AgentAccountFactory` with the new bundler/issuer addresses. NEW accounts use the new keys. EXISTING accounts continue to point to the LOST keys; users on those accounts are stuck. | Days. Acceptable for demo (fresh-start re-seeds). Not acceptable for production. |
| **(b) Phase A.1 RoleRegistry** | Each AgentAccount reads bundler/issuer via a contract registry. RoleRegistry has an `updateBundler()` / `updateSessionIssuer()` admin-only entry point. Lost key → admin updates the registry → ALL accounts now point to the new bundler/issuer. | Implementation done in Phase A.1; recovery becomes one tx. **THE RECOMMENDED SHAPE.** |
| **(c) Account-by-account user upgrade** | Each user signs an `upgradeToWithAuthorization` to a new impl with the new bundler/issuer baked in. UX hostile; not feasible. | Theoretical only. |

The default recovery plan post-Phase-A.1 is (b): one multisig-authorised
transaction updates the registry; all accounts pick up the new
bundler/issuer addresses on next userOp.

---

## 4. Envelope KEK loss — confidentiality vs. availability

### 4.1 What's encrypted under the envelope KEK

Per-session data keys are wrapped by the envelope KEK and stored in the
`sessions.encrypted_data_key` column. The session row itself is
AES-GCM-encrypted with the unwrapped data key. If the envelope KEK is
destroyed (or its key material lost), **every existing session row is
permanently undecryptable**.

### 4.2 What this means for user accounts

- On-chain account state: unaffected.
- User funds: unaffected.
- Session-resident data: gone. Session was a transient cache; users
  re-authenticate.

### 4.3 Recovery

- Provision a new envelope KEK.
- TRUNCATE the sessions table OR let existing rows fail decryption
  (they'll be GC'd on next session expiry).
- Users re-authenticate.

**Net effect**: no permanent damage; UX disruption of "you've been
signed out".

### 4.4 Mitigation

- DO NOT destroy envelope KEKs without confirming sessions table is
  empty (or accepting the re-auth event).
- AWS KMS `ScheduleKeyDeletion` has a default 30-day pending window
  during which deletion can be cancelled — use this.
- Use the `RetainOnDelete` deletion protection where available.

---

## 5. Upgrade-authority loss — THE highest-blast-radius scenario

### 5.1 Where this comes from

Pre-Phase-A: account upgrades were `onlySelf`-gated; effectively any
co-owner of the account could call `upgradeTo` via a self-call. Master
was a co-owner → master could upgrade. This was M-1 in the audit.

Post-Phase-A: account upgrades require an owner-signed
`upgradeToWithAuthorization`. The OWNER signs (passkey / EOA), not
master. **Upgrade authority is now per-account, held by the user.**

But: factory / DelegationManager / RoleRegistry contracts have their
OWN upgrade authority. Today (pre-Phase-A.1) these are owner-of-deploy
which has been the deployer EOA. Post-Phase-A.1, the recommended
shape is to make these upgradable by an N-of-M multisig.

### 5.2 If the upgrade-authority multisig key is lost

- Existing contracts continue to function — they don't need an upgrade
  to keep running.
- We cannot patch a critical bug in the factory / DelegationManager /
  RoleRegistry without redeploying entirely fresh (and re-seeding all
  user accounts, which means user migration UX).
- THIS is the "we can't fix anything" scenario for the core contract
  set.

### 5.3 Mitigation: N-of-M multisig with geographic distribution

| Parameter | Recommendation | Rationale |
|---|---|---|
| **N (signers needed)** | 3 | Enough to be safe against ≤2-signer collusion or compromise. |
| **M (total signers)** | 5 | Tolerates loss of up to 2 signers before recovery becomes impossible. |
| **Signer identity** | 5 individuals: 2 engineering, 2 security, 1 board / advisor. | Diverse roles; reduces single-point-of-collusion risk. |
| **Key storage** | Hardware wallet (Ledger Nano X or equivalent) per signer + paper backup. | Hardware wallet for routine signing; paper backup for recovery. |
| **Backup storage** | Paper backups distributed across 5 geographically distinct, jurisdictionally distinct, climate-resilient secure-storage locations (bank safe-deposit boxes in different states / countries). | Reduces geographic single-point-of-failure. |
| **Backup format** | 24-word BIP-39 mnemonic on Cryptosteel (or equivalent steel plate); printed on archival paper as redundancy. | Steel survives fire / water / decades; paper is easier to read. |
| **Annual integrity drill** | Each signer produces a no-op signature on a published test message; results aggregated and archived. | Confirms each key is still operational. |
| **Annual recovery drill** | One signer retrieves their paper backup, restores the key, produces a signature, then re-secures the paper backup. | Confirms recovery procedure works. |
| **Multisig contract** | Gnosis Safe (or our own multisig). | Per P1, we DO NOT depend on Safe at runtime; the multisig contract MUST be re-implemented as `packages/contracts/src/Multisig.sol` or equivalent. Gnosis Safe is a documentation reference, not a dependency. |

### 5.4 If a single signer's key is compromised

- Compromised signer's key is REPLACED via a multisig transaction
  (signed by the other 4 or any N=3 subset) that updates the
  multisig's signer set.
- The replaced signer rotates their physical key + paper backup.
- No system downtime.

### 5.5 If 3 signers' keys are compromised simultaneously

- This IS the end of multisig integrity. The attacker can authorise
  any upgrade.
- Mitigation: detect via K6 (multisig contract emits an event on every
  signature; we alert if N ≥ 3 signatures occur in a short window
  outside of a planned ceremony).
- Recovery: not really. At this point we have to redeploy fresh
  contracts and ask users to migrate.

This is THE scenario the multisig design is meant to prevent. The
multisig is the LAST line of defense; if it falls, the system's core
contracts are at the attacker's mercy.

---

## 6. Design choices the user / board needs to make

| # | Choice | Recommendation | Rationale |
|---|---|---|---|
| **K5-C1** | Implement Phase A.1 (RoleRegistry) before production traffic? | YES, mandatory. | Otherwise bundler/issuer rotation requires factory redeploy; recovery from key loss is account-bricking. |
| **K5-C2** | Where does upgrade authority for factory / DelegationManager / RoleRegistry live? | N-of-M multisig (3-of-5) per § 5.3. | Single-key authority is catastrophic on loss. |
| **K5-C3** | Who are the 5 multisig signers? | 2 engineering, 2 security, 1 board / advisor. | Diverse roles. Specific names: TBD by founder + board. |
| **K5-C4** | Where are the paper backups stored? | 5 distinct secure-storage locations across at least 3 jurisdictions. | Geographic distribution. |
| **K5-C5** | What's the ceremony cadence? | Annual integrity drill; annual recovery drill (alternating). | Operationally light; catches signer dropout. |
| **K5-C6** | Do we escrow KMS key material in addition to multisig? | NO. | Escrowing KMS material defeats the purpose of using KMS (non-extractable keys). Multisig provides the recovery path; KMS provides the runtime path. They are separate concerns. |
| **K5-C7** | Do we use a key custodian service (Coinbase Custody, Fireblocks)? | NO. | Per P1 (substrate independence), we hold the keys ourselves. Custodians are useful for ENTERPRISE customers who want to hold their own custody key but trust a third party; that's a customer-facing feature, not an internal infrastructure choice. |

These are board-level decisions; the operator implements after they
are locked in.

---

## 7. The "what if everything is gone" thought experiment

To stress-test the design:

**Scenario**: tomorrow morning, AWS terminates our account, GCP
terminates our project, the multisig hardware wallets are stolen, and
the paper backups are in a flooded basement.

**What survives?**

- The on-chain contracts — they are deployed, immutable in code (only
  upgradable via multisig which is now lost), and continue to operate.
- User AgentAccounts — they continue to exist; users still own them
  via their passkey/EOA.
- User funds — still in the AgentAccounts; users can interact directly
  via `EntryPoint.handleOps` from any RPC.

**What's lost?**

- Master / bundler / sessionIssuer keys — these were KMS-resident; gone.
- The ability to MINT new AgentAccounts via our factory (the factory
  still exists, but no relay layer to submit createAccount userOps;
  users would have to submit directly).
- The ability to UPGRADE any of our core contracts (multisig lost).
- The audit chain — past records exist in archived storage; ongoing
  recording stops.
- The session-resident data — gone; users re-authenticate to a service
  that no longer exists.

**Net assessment**: the catastrophic scenario does NOT result in user
fund loss. The system goes dark, but users retain on-chain ownership
of their accounts and funds. This is the lower bound of the security
guarantee.

This is a meaningful claim and it's directly traceable to:

- Per-account user ownership (passkey/EOA at the AgentAccount layer).
- Phase A's removal of master co-ownership.
- ERC-4337's design (anyone can submit userOps; the user's signature
  is what authorises).
- Substrate independence (our contracts deployed; not dependent on a
  vendor that could revoke).

---

## 8. Action items

| # | Action | Owner | Status |
|---|---|---|---|
| **K5-A1** | Resolve K5-Q1: is `executeFromBundler` the ONLY entry to account execution, or does the standard `validateUserOp` path remain usable? Document the answer in Phase A acceptance criteria. | Reviewer + Developer | NOT STARTED |
| **K5-A2** | Implement Phase A.1 — RoleRegistry contract; update AgentAccount to read bundler/issuer via registry; multisig-gated `updateBundler()` / `updateSessionIssuer()`. | Developer | NOT STARTED |
| **K5-A3** | Re-implement the multisig contract under `packages/contracts/src/Multisig.sol` (per P1 — no Safe dependency). | Developer | NOT STARTED |
| **K5-A4** | Lock in K5-C3 / C4 (multisig signer identities + paper backup locations). | Founder + Board | NOT STARTED |
| **K5-A5** | Document the multisig ceremony runbook (M4 in K3) — a SEPARATE doc when the design is locked. | Documentarian + Security | NOT STARTED |
| **K5-A6** | Quarterly integrity drill — first instance after K5-A2/A3 land + signers are onboarded. | Operator | NOT STARTED |
| **K5-A7** | Annual recovery drill — restore one signer's key from paper backup, sign a test message, re-secure. | Operator | NOT STARTED |
| **K5-A8** | Document the user-direct-submission path (UX procedure for a user to submit a userOp directly to `EntryPoint.handleOps` without the a2a-agent relay). Sometimes called "bypass mode". | UX Designer + Developer | NOT STARTED |
| **K5-A9** | Add monitoring on multisig contract — alert on any N ≥ 2 signatures outside of a planned ceremony window. | Security + Infra | NOT STARTED |

---

## 9. Honest disclosure

| Claim | True today? |
|---|---|
| "We have key escrow." | NO. |
| "We can recover from bundler/issuer key loss." | NO (pre-A.1) — would require factory redeploy. |
| "Master-key loss does NOT brick user accounts." | YES, post-Phase-A (the security win). |
| "We have a multisig for upgrade authority." | NO. |
| "We can recover from a worst-case (everything-gone) scenario without user fund loss." | YES, structurally — user accounts are owned by users, not by us. The system can go dark; user funds remain user-controlled. |
| "We have documented the user-direct-submission path." | NO — flagged as K5-A8. |

After K5-A2 / A3 / A4 / A5 land:

| Claim | True after action items? |
|---|---|
| "We can recover from bundler/issuer key loss in one multisig tx." | YES. |
| "Upgrade authority is N-of-M multisig'd." | YES. |
| "We have an annual integrity + recovery drill." | YES, after first ceremony. |

---

*Last updated: 2026-05-18.*
