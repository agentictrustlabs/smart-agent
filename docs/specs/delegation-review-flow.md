# Delegation-Based Review Flow

## Overview

Reviews in the Smart Agent system are submitted through the **DelegationManager** (ERC-7710 aligned). A reviewer doesn't call `AgentReviewRecord.createReview()` directly. Instead, the **subject agent** delegates review authority to the reviewer via a signed, caveat-bound delegation. The reviewer redeems that delegation, which causes the DelegationManager to execute the `createReview` call **through the subject agent's smart account**.

This proves the full delegation pipeline:

```
Relationship → Confirmation → Delegation Issuance → Caveat Enforcement → Delegated Execution → Review Created
```

## End-to-End Flow

### Phase 1: Establish Reviewer Relationship

```
Reviewer                    Web App                  AgentRelationship Contract
   │                           │                              │
   │  Select target agent      │                              │
   │  Choose "reviewer" role   │                              │
   │  Click "Create"           │                              │
   │ ─────────────────────────>│                              │
   │                           │  createEdge(                 │
   │                           │    subject: reviewerAgent,   │
   │                           │    object: subjectAgent,     │
   │                           │    type: REVIEW_RELATIONSHIP,│
   │                           │    roles: [ROLE_REVIEWER],   │
   │                           │    metadataURI: ""           │
   │                           │  ) ─────────────────────────>│
   │                           │                              │ Edge created: PROPOSED
   │                           │                              │
   │                           │  makeAssertion(              │
   │                           │    edgeId, SELF_ASSERTED     │
   │                           │  ) ─────────────────────────>│ (AgentAssertion)
   │                           │                              │
   │                           │  [If user owns both agents:  │
   │                           │   auto-confirm + issue       │
   │                           │   delegation → skip to       │
   │                           │   Phase 2 output]            │
   │                           │                              │
   │                           │  [If different owners:       │
   │                           │   notify subject owner]      │
   │                           │                              │
```

**On-chain state after Phase 1:**
- Edge exists: `reviewerAgent → subjectAgent` with type `REVIEW_RELATIONSHIP`
- Edge status: `PROPOSED` (awaiting counterparty confirmation)
- Role: `ROLE_REVIEWER = keccak256("reviewer")`
- Assertion: `SELF_ASSERTED` by the reviewer

### Phase 2: Confirm Relationship + Auto-Issue Delegation

```
Subject Owner               Web App                  Contracts
   │                           │                        │
   │  See pending relationship │                        │
   │  Click "Confirm"          │                        │
   │ ─────────────────────────>│                        │
   │                           │                        │
   │                    ┌──────┴──────┐                  │
   │                    │ confirmRel- │                  │
   │                    │ ationship-  │                  │
   │                    │ Action()    │                  │
   │                    └──────┬──────┘                  │
   │                           │                        │
   │                           │  ── Step 1: Confirm ──  │
   │                           │  setEdgeStatus(         │
   │                           │    edgeId, CONFIRMED=2) │
   │                           │ ──────────────────────>│ AgentRelationship
   │                           │  setEdgeStatus(         │
   │                           │    edgeId, ACTIVE=3)    │
   │                           │ ──────────────────────>│
   │                           │  makeAssertion(         │
   │                           │    edgeId,              │
   │                           │    OBJECT_ASSERTED=2)   │
   │                           │ ──────────────────────>│ AgentAssertion
   │                           │                        │
   │                           │  ── Step 2: Check ──    │
   │                           │  getEdgeRoles(edgeId)   │
   │                           │ ──────────────────────>│
   │                           │  <── [ROLE_REVIEWER] ── │
   │                           │                        │
   │                           │  ── Step 3: Issue ──    │
   │                           │  Delegation             │
   │                           │  (see Phase 2b below)   │
   │                           │                        │
```

**On-chain state after confirmation:**
- Edge status: `ACTIVE`
- Assertions: `SELF_ASSERTED` + `OBJECT_ASSERTED`

### Phase 2b: Delegation Issuance (Detail)

```
Web App (Server)            DelegationManager        Subject Agent (ERC-1271)
   │                              │                         │
   │  Build 3 caveats:            │                         │
   │  ┌─────────────────────────┐ │                         │
   │  │ 1. TimestampEnforcer    │ │                         │
   │  │    terms: (now, now+7d) │ │                         │
   │  │ 2. AllowedMethods       │ │                         │
   │  │    terms: [0x7e653da2]  │ │  (createReview sel.)    │
   │  │ 3. AllowedTargets       │ │                         │
   │  │    terms: [ReviewAddr]  │ │                         │
   │  └─────────────────────────┘ │                         │
   │                              │                         │
   │  Build unsigned Delegation:  │                         │
   │  ┌─────────────────────────┐ │                         │
   │  │ delegator: subjectAgent │ │                         │
   │  │ delegate:  deployer EOA │ │                         │
   │  │ authority: ROOT         │ │                         │
   │  │ caveats:   [3 above]   │ │                         │
   │  │ salt:      random      │ │                         │
   │  │ signature: 0x          │ │                         │
   │  └─────────────────────────┘ │                         │
   │                              │                         │
   │  hashDelegation(delegation)  │                         │
   │ ────────────────────────────>│                         │
   │  <── bytes32 delegationHash  │                         │
   │                              │                         │
   │  Deployer signs hash         │                         │
   │  (EIP-191 personal sign)     │                         │
   │                              │                         │
   │  Store in DB:                │                         │
   │  reviewDelegations table     │                         │
   │  {reviewerAgent, subjectAgent, delegationJson, expiry} │
   │                              │                         │
```

**Why the deployer signs:** The deployer is an **owner** of the subject agent (set during factory deployment). When the DelegationManager validates the signature, it calls `subjectAgent.isValidSignature(hash, signature)` (ERC-1271). The smart account recovers the signer from the signature and checks `_owners[recovered]` — the deployer is in that set, so validation passes.

**Why delegate = deployer:** Currently the server relays all transactions. The DelegationManager checks `d.delegate == msg.sender` at redemption time. Since the deployer is the transaction sender, the delegate must be the deployer address. When users submit transactions directly (e.g., via ERC-4337 bundler on Sepolia), the delegate would be the reviewer's smart account instead.

**Delegation stored in DB:**
```sql
review_delegations (
  id, reviewer_agent_address, subject_agent_address,
  edge_id, delegation_json, salt, expires_at, status
)
```

### Phase 3: Submit Review via Delegation

```
Reviewer                    Web App (Server)
   │                           │
   │  Fill review form:        │
   │  - Agent to review        │
   │  - Review type            │
   │  - Recommendation         │
   │  - Overall score (0-100)  │
   │  - Dimension scores       │
   │  - Comment                │
   │  Click "Submit"           │
   │ ─────────────────────────>│
   │                           │
   │                    ┌──────┴──────┐
   │                    │ submitReview│
   │                    │  Action()  │
   │                    └──────┬──────┘
   │                           │
   │                           │ 1. Verify session + person agent
   │                           │ 2. Verify ACTIVE reviewer relationship
   │                           │ 3. Load delegation from DB
   │                           │    (or issue fresh if expired/missing)
   │                           │ 4. Encode createReview calldata
   │                           │ 5. Call redeemReviewDelegation()
   │                           │
```

### Phase 3b: Delegation Redemption (On-Chain Detail)

This is the core on-chain interaction. The DelegationManager orchestrates validation, caveat enforcement, and delegated execution.

```
Deployer EOA          DelegationManager        Enforcers              Subject Agent         ReviewRecord
   │                        │                      │                       │                     │
   │ redeemDelegation(      │                      │                       │                     │
   │   delegations=[d],     │                      │                       │                     │
   │   target=ReviewRecord, │                      │                       │                     │
   │   value=0,             │                      │                       │                     │
   │   data=createReview()  │                      │                       │                     │
   │ )                      │                      │                       │                     │
   │ ──────────────────────>│                      │                       │                     │
   │                        │                      │                       │                     │
   │                 ┌──────┴──────────────────────────────────────────────────────────────────┐  │
   │                 │ PHASE 1: VALIDATE DELEGATION CHAIN (leaf to root)                      │  │
   │                 │                                                                        │  │
   │                 │  _validateDelegation(delegations, 0):                                  │  │
   │                 │    1. Check not revoked: _revoked[hash] == false                       │  │
   │                 │    2. Check delegate: d.delegate == msg.sender (deployer) ✓            │  │
   │                 │    3. Check authority: ROOT_AUTHORITY ✓                                │  │
   │                 │    4. Validate signature:                                              │  │
   │                 │       └─ signer.code.length > 0 → ERC-1271                            │  │
   │                 │                      │                       │                         │  │
   │                 │                      │  isValidSignature(    │                         │  │
   │                 │                      │    hash, signature)   │                         │  │
   │                 │                      │ ─────────────────────>│                         │  │
   │                 │                      │                       │ recover signer from sig  │  │
   │                 │                      │                       │ check _owners[signer]    │  │
   │                 │                      │  <── 0x1626ba7e ─────│ (deployer is owner ✓)   │  │
   │                 │                      │                       │                         │  │
   │                 │    5. Emit DelegationRedeemed                                          │  │
   │                 └───────────────────────────────────────────────────────────────────────┘  │
   │                        │                      │                       │                     │
   │                 ┌──────┴──────────────────────────────────────────────────────────────────┐  │
   │                 │ PHASE 1b: RUN BEFORE-HOOKS (leaf to root)                              │  │
   │                 │                                                                        │  │
   │                 │  _runBeforeHooks(d, target, value, data):                              │  │
   │                 │                      │                       │                         │  │
   │                 │    Caveat 1: TimestampEnforcer                                        │  │
   │                 │                      │                       │                         │  │
   │                 │      beforeHook(     │                       │                         │  │
   │                 │        terms,args,   │                       │                         │  │
   │                 │        hash,delegator│                       │                         │  │
   │                 │        redeemer,tgt, │                       │                         │  │
   │                 │        value,data)   │                       │                         │  │
   │                 │      ───────────────>│                       │                         │  │
   │                 │                      │ decode(validAfter,    │                         │  │
   │                 │                      │        validUntil)    │                         │  │
   │                 │                      │ check: now >= after   │                         │  │
   │                 │                      │ check: now <= until   │                         │  │
   │                 │      <── (no revert) │                       │                         │  │
   │                 │                      │                       │                         │  │
   │                 │    Caveat 2: AllowedMethodsEnforcer                                   │  │
   │                 │      beforeHook(...) │                       │                         │  │
   │                 │      ───────────────>│                       │                         │  │
   │                 │                      │ extract selector from │                         │  │
   │                 │                      │ calldata[:4]          │                         │  │
   │                 │                      │ check: 0x7e653da2    │                         │  │
   │                 │                      │ ∈ [0x7e653da2] ✓     │                         │  │
   │                 │      <── (no revert) │                       │                         │  │
   │                 │                      │                       │                         │  │
   │                 │    Caveat 3: AllowedTargetsEnforcer                                   │  │
   │                 │      beforeHook(...) │                       │                         │  │
   │                 │      ───────────────>│                       │                         │  │
   │                 │                      │ check: target         │                         │  │
   │                 │                      │ ∈ [ReviewRecord] ✓   │                         │  │
   │                 │      <── (no revert) │                       │                         │  │
   │                 └───────────────────────────────────────────────────────────────────────┘  │
   │                        │                      │                       │                     │
   │                 ┌──────┴──────────────────────────────────────────────────────────────────┐  │
   │                 │ PHASE 2: EXECUTE THROUGH DELEGATOR ACCOUNT                             │  │
   │                 │                                                                        │  │
   │                 │  _executeFromDelegator(subjectAgent, ReviewRecord, 0, createReviewData) │  │
   │                 │                      │                       │                         │  │
   │                 │  subjectAgent.execute(│                      │                         │  │
   │                 │    target=ReviewRecord│                      │                         │  │
   │                 │    value=0,           │                      │                         │  │
   │                 │    data=createReview) │                      │                         │  │
   │                 │  ───────────────────────────────────────────>│                         │  │
   │                 │                      │                       │                         │  │
   │                 │                      │                       │ _requireForExecute():    │  │
   │                 │                      │                       │ msg.sender ==            │  │
   │                 │                      │                       │ _delegationManager ✓     │  │
   │                 │                      │                       │                         │  │
   │                 │                      │                       │ createReview(            │  │
   │                 │                      │                       │   reviewer,subject,      │  │
   │                 │                      │                       │   type,rec,score,        │  │
   │                 │                      │                       │   dimensions,comment,    │  │
   │                 │                      │                       │   evidenceURI            │  │
   │                 │                      │                       │ ) ──────────────────────>│  │
   │                 │                      │                       │                         │  │
   │                 │                      │                       │          reviewer != subject ✓
   │                 │                      │                       │          score <= 100 ✓  │  │
   │                 │                      │                       │          Store review    │  │
   │                 │                      │                       │          Track by subj.  │  │
   │                 │                      │                       │          Track reviewer  │  │
   │                 │                      │                       │          Emit event      │  │
   │                 │                      │                       │  <── reviewId ───────────│  │
   │                 │  <─────────────────────────────────────────── │                         │  │
   │                 └───────────────────────────────────────────────────────────────────────┘  │
   │                        │                      │                       │                     │
   │                 ┌──────┴──────────────────────────────────────────────────────────────────┐  │
   │                 │ PHASE 3: RUN AFTER-HOOKS (root to leaf — reverse order)                │  │
   │                 │                                                                        │  │
   │                 │  _runAfterHooks(d, target, value, data):                               │  │
   │                 │    All 3 enforcers: afterHook() → no-op (pure)                         │  │
   │                 └───────────────────────────────────────────────────────────────────────┘  │
   │                        │                      │                       │                     │
   │  <── tx receipt ────── │                      │                       │                     │
   │                        │                      │                       │                     │
```

### Phase 4: Post-Review

```
Web App (Server)            Database                  Subject Owner
   │                           │                           │
   │  Insert notification:     │                           │
   │  type: review_received    │                           │
   │  "Your agent received     │                           │
   │   a [recommendation]      │                           │
   │   review (score: X/100)"  │                           │
   │ ─────────────────────────>│                           │
   │                           │                           │
   │                           │     Dashboard shows       │
   │                           │     notification          │
   │                           │ ─────────────────────────>│
   │                           │                           │
```

**On-chain state after review:**
- `AgentReviewRecord._reviews[reviewId]` stores the full Review struct
- `_bySubject[subjectAgent]` includes reviewId
- `_byReviewer[reviewerAgent]` includes reviewId
- `_reviewers[subjectAgent]` includes reviewerAgent (if first review)
- `ReviewCreated` event emitted

## Contract Architecture

```
                    ┌─────────────────────┐
                    │  AgentAccountFactory │
                    │  ─────────────────  │
                    │  delegationManager  │──── stored at creation
                    │  createAccount()    │
                    └────────┬────────────┘
                             │ deploys ERC1967Proxy
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                     AgentRootAccount                         │
│  ──────────────────────────────────────────────────────────  │
│  UUPS Upgradeable (ERC-1822)                                 │
│  ERC-4337 Smart Account (validateUserOp)                     │
│  ERC-1271 Signature Validation (isValidSignature)            │
│  ──────────────────────────────────────────────────────────  │
│  _owners: mapping(address => bool)                           │
│  _delegationManager: address  ◄── set during initialize()   │
│  ──────────────────────────────────────────────────────────  │
│  _requireForExecute():                                       │
│    allows: EntryPoint | self | _delegationManager            │
│  execute(target, value, data):                               │
│    guarded by _requireForExecute                             │
└──────────────────────────────────────────────────────────────┘
          ▲                          ▲
          │ isValidSignature()       │ execute()
          │ (ERC-1271)               │ (delegated call)
          │                          │
┌─────────┴──────────────────────────┴─────────────────────────┐
│                     DelegationManager                         │
│  ──────────────────────────────────────────────────────────  │
│  ERC-7710 / MetaMask DeleGator aligned                       │
│  ──────────────────────────────────────────────────────────  │
│  redeemDelegation(delegations[], target, value, data):       │
│    1. Validate chain (leaf → root)                           │
│       - check not revoked                                    │
│       - check delegate == msg.sender or OPEN_DELEGATION      │
│       - check authority chain                                │
│       - validate EIP-712 signature (EOA or ERC-1271)         │
│    2. Run beforeHooks on each caveat                         │
│    3. Execute via delegator.execute(target, value, data)     │
│    4. Run afterHooks in reverse order                        │
│  ──────────────────────────────────────────────────────────  │
│  hashDelegation(d) → bytes32:                                │
│    EIP-712: hash(DOMAIN_SEP, structHash)                     │
│    Caveat args EXCLUDED from hash (redeemer-provided)        │
│  ──────────────────────────────────────────────────────────  │
│  Delegation struct:                                          │
│    delegator, delegate, authority, caveats[], salt, signature│
│  Caveat struct:                                              │
│    enforcer, terms (signed), args (unsigned, runtime)        │
└──────────────────────────────────────────────────────────────┘
          │ beforeHook() / afterHook()
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Caveat Enforcers                           │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  ┌─────────────────────┐  ┌────────────────────────────┐    │
│  │ TimestampEnforcer    │  │ AllowedMethodsEnforcer     │    │
│  │ ─────────────────── │  │ ────────────────────────── │    │
│  │ terms: (validAfter,  │  │ terms: (bytes4[] selectors)│    │
│  │         validUntil)  │  │ check: calldata[:4]        │    │
│  │ check: block.time-   │  │        ∈ selectors         │    │
│  │        stamp in range│  │ revert: MethodNotAllowed   │    │
│  │ revert: Timestamp-   │  └────────────────────────────┘    │
│  │         Expired or   │                                    │
│  │         NotYetValid  │  ┌────────────────────────────┐    │
│  └─────────────────────┘  │ AllowedTargetsEnforcer     │    │
│                            │ ────────────────────────── │    │
│                            │ terms: (address[] targets)│    │
│                            │ check: target ∈ targets   │    │
│                            │ revert: TargetNotAllowed  │    │
│                            └────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

          ┌──── execute() lands here ────┐
          ▼                              │
┌──────────────────────────────┐         │
│    AgentReviewRecord         │         │
│  ────────────────────────── │         │
│  createReview(               │         │
│    reviewer,  ◄── person agent address │
│    subject,   ◄── agent being reviewed │
│    reviewType,               │         │
│    recommendation,           │         │
│    overallScore,             │         │
│    dimensions[],             │         │
│    comment,                  │         │
│    evidenceURI               │         │
│  ) → reviewId                │         │
│  ────────────────────────── │         │
│  Anti-self-feedback:         │         │
│    reviewer != subject       │         │
│  msg.sender = subjectAgent   │◄────────┘
│    (via DelegationManager    │
│     → account.execute)       │
└──────────────────────────────┘
```

## Signature & Trust Chain

```
Deployer EOA (0xf39F...)
    │
    │ owns (is in _owners set of)
    ▼
Subject Agent Smart Account (0x9242...)
    │
    │ delegates review authority to
    │ (via EIP-712 signed Delegation struct)
    ▼
Deployer EOA (delegate = msg.sender of redeemDelegation)
    │
    │ calldata encodes reviewer identity
    ▼
AgentReviewRecord.createReview(reviewer=reviewerAgent, subject=subjectAgent, ...)
```

**Trust guarantees:**
1. **Delegation is signed** by the subject agent (via ERC-1271 → deployer is owner)
2. **Caveats enforce scope** — only `createReview`, only `AgentReviewRecord`, only within time window
3. **Anti-self-feedback** — contract rejects `reviewer == subject`
4. **Relationship required** — server action verifies `ACTIVE` reviewer relationship before submission
5. **On-chain immutability** — review stored permanently in `AgentReviewRecord` contract storage

## Data Structures

### Delegation (stored in DB `review_delegations` table)

```json
{
  "delegator": "0x9242...",           // subject agent smart account
  "delegate": "0xf39F...",            // deployer (server relay)
  "authority": "0xffff...ffff",       // ROOT_AUTHORITY
  "caveats": [
    {
      "enforcer": "0xaA43...",        // TimestampEnforcer
      "terms": "0x000...validAfter...validUntil...",
      "args": "0x"
    },
    {
      "enforcer": "0x8AAF...",        // AllowedMethodsEnforcer
      "terms": "0x000...7e653da2...", // createReview selector
      "args": "0x"
    },
    {
      "enforcer": "0x5d42...",        // AllowedTargetsEnforcer
      "terms": "0x000...ReviewRecordAddress...",
      "args": "0x"
    }
  ],
  "salt": "7997111181009408",
  "signature": "0xfb16c203..."       // deployer's EIP-191 signature
}
```

### Review (stored on-chain in `AgentReviewRecord`)

```solidity
Review {
    reviewId:       0
    reviewer:       0x59A4...   // reviewer's person agent
    subject:        0x9242...   // agent being reviewed
    reviewType:     keccak256("PerformanceReview")
    recommendation: keccak256("endorses")
    overallScore:   85
    signedValue:    85          // ERC-8004 style
    valueDecimals:  0
    tag1:           ""
    tag2:           ""
    endpoint:       ""
    comment:        "Excellent agent performance"
    evidenceURI:    ""
    feedbackHash:   0x00...00
    createdAt:      1712678400  // block.timestamp
    revoked:        false
}
```

## ERC-7710 Compliance Notes

| Feature | Our Implementation | ERC-7710 / DeleGator Pattern |
|---------|-------------------|------------------------------|
| Caveat struct | `{enforcer, terms, args}` | `{enforcer, terms, args}` |
| Enforcer interface | `beforeHook()` / `afterHook()` — revert on failure | `beforeHook()` / `afterHook()` — revert on failure |
| Execution path | DelegationManager → `delegator.execute()` → target | DelegationManager → `executeFromExecutor()` → target |
| Open delegations | `delegate = address(0xa11)` | `delegate = address(0xa11)` |
| Signature validation | EIP-712 + ERC-1271 for smart accounts | EIP-712 + ERC-1271 for smart accounts |
| Caveat args in hash | Excluded (redeemer-provided runtime data) | Excluded (redeemer-provided runtime data) |
| Hook execution order | beforeHooks: leaf→root, afterHooks: root→leaf | beforeHooks: leaf→root, afterHooks: root→leaf |
| UUPS upgradeability | AgentRootAccount inherits UUPSUpgradeable | DeleGator accounts are upgradeable |

## Failure Modes

| Scenario | What Happens | Error |
|----------|-------------|-------|
| No reviewer relationship | Server action rejects before any on-chain call | "You need an active reviewer relationship" |
| Delegation expired | TimestampEnforcer reverts in beforeHook | `TimestampExpired()` |
| Wrong function called | AllowedMethodsEnforcer reverts | `MethodNotAllowed()` |
| Wrong target contract | AllowedTargetsEnforcer reverts | `TargetNotAllowed()` |
| Delegation revoked | DelegationManager checks `_revoked[hash]` | `DelegationRevoked_()` |
| Invalid signature | ERC-1271 returns wrong magic value | `InvalidSignature()` |
| Self-review attempt | AgentReviewRecord rejects | `SelfFeedbackNotAllowed()` |
| DelegationManager not set | `_requireForExecute` rejects DM as caller | `NotFromEntryPoint()` |
| Delegation delegate mismatch | DM checks `d.delegate == msg.sender` | `InvalidDelegate()` |

## Future: ERC-4337 Flow (Sepolia/Mainnet)

When moving to a bundler + paymaster setup, the only changes are at the app layer:

```
Current:  Deployer EOA → DelegationManager.redeemDelegation()
Future:   Reviewer → UserOp → Bundler → EntryPoint → Reviewer Account
          → DelegationManager.redeemDelegation()
```

**Changes needed:**
1. `delegate` field = reviewer's smart account (not deployer)
2. Build `PackedUserOperation` instead of direct `writeContract`
3. Submit to bundler instead of RPC
4. Paymaster pays gas

**No contract changes required.** The `_requireForExecute` already allows EntryPoint, self, and DelegationManager.
