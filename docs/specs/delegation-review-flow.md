# Delegation-Based Review Flow — PM Spec

## Overview

First real use of the DelegationManager for gated operations. A reviewer must:
1. Request a reviewer relationship with an agent
2. Agent owner approves the relationship
3. System instantiates a caveat-bound delegation from the agent's template
4. Reviewer uses that delegation to submit a review through the agent's smart account

This proves the full delegation pipeline: relationship → confirmation → template → delegation → caveated execution.

## Architecture

```
Reviewer EOA
    │
    ├─ 1. createEdge(reviewer → agent, ReviewRelationship, reviewer role) → PROPOSED
    │
    ├─ 2. Agent owner confirms → ACTIVE
    │
    ├─ 3. System checks template: ReviewRelationship + reviewer → ReviewerAccessTemplate
    │      Template says: TimestampEnforcer required, AllowedMethodsEnforcer (createReview only)
    │
    ├─ 4. DelegationManager.redeemDelegation()
    │      - Delegation chain: agent account delegates to reviewer
    │      - Caveats: timestamp (24h), allowedMethods (createReview selector)
    │      - Executes: AgentReviewRecord.createReview() through the agent account
    │
    └─ 5. Review recorded on-chain with agent account as caller context
```

## Detailed Flow

### Step 1: Request Reviewer Relationship
- Reviewer goes to `/relationships`
- Selects their person agent as "From"
- Selects target agent as "To"
- Selects role "reviewer"
- Clicks "Create Relationship"
- Edge created as PROPOSED
- Notification sent to agent owner

### Step 2: Agent Owner Confirms
- Agent owner sees notification / pending relationship
- Goes to `/relationships`
- Clicks "Confirm" on the proposed reviewer edge
- Edge becomes ACTIVE
- Notification sent to reviewer: "Your reviewer relationship has been confirmed"

### Step 3: Delegation Instantiation
On confirmation, the system:
1. Looks up template: ReviewRelationship + reviewer → "Reviewer Access" template
2. Creates a delegation:
   - delegator = target agent smart account
   - delegate = reviewer's person agent
   - caveats:
     - TimestampEnforcer: valid for 24 hours (or template default)
     - AllowedMethodsEnforcer: only `createReview(address,bytes32,bytes32,uint8,(bytes32,uint8)[],string,string)` selector
3. Signs delegation via DelegationManager
4. Stores delegation reference in DB

### Step 4: Submit Review
- Reviewer goes to new `/reviews/submit` page
- Selects which agent to review (only agents where they have active reviewer relationship)
- Fills in review form:
  - Review type (Performance, Trust, Quality, Safety)
  - Recommendation (Endorses, Recommends, Neutral, Flags, Disputes)
  - Overall score (0-100)
  - Dimension scores (accuracy, reliability, safety, etc.)
  - Comment text
- Clicks "Submit Review"
- Backend calls DelegationManager.redeemDelegation():
  - Passes the delegation chain
  - Target = AgentReviewRecord address
  - Data = createReview() calldata
  - Caveats validated by enforcers
- Review recorded on-chain

### Step 5: Review Visible
- Review appears on `/reviews` page
- Review appears in agent's graph detail panel
- Trust profile score updated

## Implementation Sprints

### Sprint 1: Review Submission UI + Server Action ✅
**Developer:**
- [x] Create `/reviews/submit` page with review form
- [x] `SubmitReviewClient.tsx` — form with agent selector, review type, scores, comment
- [x] Server action `submit-review.action.ts` — calls AgentReviewRecord.createReview()
- [x] Only show agents where user has confirmed reviewer relationship
- [x] Notification to agent owner on review submission

### Sprint 2: Delegation Template for Reviewers ✅
**Developer:**
- [x] Create "Reviewer Access" template in seed script
- [x] Template: ReviewRelationship + reviewer role
- [x] Required caveats: TimestampEnforcer, AllowedMethodsEnforcer
- [x] On relationship confirm, auto-create delegation if template exists
- [x] Store delegation in `reviewDelegations` DB table

### Sprint 3: Route Review Through DelegationManager ✅
**Developer + Web3:**
- [x] Build delegation for reviewer: delegator=agent, delegate=reviewer, caveats from template
- [x] Sign delegation via DelegationManager (deployer signs as ERC-1271 owner)
- [x] Submit review via DelegationManager.redeemDelegation()
- [x] Caveats enforce: TimestampEnforcer (7d window), AllowedMethodsEnforcer (createReview), AllowedTargetsEnforcer (AgentReviewRecord)
- [x] DelegationManager executes through delegator account (ERC-7710 pattern)
- [x] Auto-renew expired delegations on submit

### Sprint 3.5: ERC-7710 Compliance ✅
**Web3:**
- [x] Updated DelegationManager to ERC-7710 / MetaMask DeleGator patterns
- [x] Caveat struct now includes `args` field (redeemer-provided, excluded from hash)
- [x] Enforcers use beforeHook/afterHook pattern (revert on failure, not bool return)
- [x] Execution goes through delegator's smart account (executeFromExecutor pattern)
- [x] Support for open delegations (delegate = address(0xa11))
- [x] Full leaf-to-root chain validation with delegate address checking
- [x] After-hooks run in reverse order (root-to-leaf per DeleGator convention)
- [x] AgentRootAccount.setDelegationManager() for ERC-7710 executor authorization

### Sprint 4: Testing
**Tester + QA:**
- [ ] E2E: request reviewer relationship → confirm → submit review → verify on-chain
- [ ] Test expired delegation (should fail after 7d)
- [ ] Test wrong method selector (should fail)
- [ ] Test review without relationship (should fail)
- [ ] Test review with unconfirmed relationship (should fail)

## Contract Interactions

```
1. AgentRelationship.createEdge(reviewer, agent, ReviewRelationship, [reviewer]) → PROPOSED
2. AgentRelationship.setEdgeStatus(edgeId, CONFIRMED → ACTIVE) + auto-issue delegation
3. DelegationManager.issueDelegation():
     - delegator = subject agent smart account
     - delegate = reviewer's person agent
     - caveats = [TimestampEnforcer(7d), AllowedMethodsEnforcer(createReview), AllowedTargetsEnforcer(AgentReviewRecord)]
     - signed by deployer (ERC-1271 owner of subject agent)
4. DelegationManager.redeemDelegation():
     - Validates delegation chain (leaf to root)
     - Runs beforeHook on each caveat (time, method, target)
     - Calls subjectAgent.execute(AgentReviewRecord, 0, createReview(...))
     - Runs afterHook in reverse order
5. AgentReviewRecord.createReview(reviewer, subject, type, rec, score, dimensions, comment, evidence)
     - msg.sender = subject agent (delegator account)
     - reviewer = reviewer's person agent address
```

## ERC-7710 Alignment

The delegation flow follows ERC-7710 and MetaMask DeleGator framework patterns:
- **Caveat struct**: `{enforcer, terms, args}` — args are redeemer-provided runtime data
- **Enforcer interface**: `beforeHook`/`afterHook` that revert on failure
- **Execution path**: DelegationManager → delegator.execute() → target.createReview()
- **Signature**: EIP-712 typed data, ERC-1271 validation for smart accounts
- **Open delegations**: `delegate = 0xa11` allows any redeemer (caveats gate access)
