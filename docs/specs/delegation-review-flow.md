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

### Sprint 1: Review Submission UI + Server Action
**Developer:**
- [ ] Create `/reviews/submit` page with review form
- [ ] `SubmitReviewClient.tsx` — form with agent selector, review type, scores, comment
- [ ] Server action `submit-review.action.ts` — calls AgentReviewRecord.createReview()
- [ ] Only show agents where user has confirmed reviewer relationship
- [ ] Notification to agent owner on review submission

### Sprint 2: Delegation Template for Reviewers
**Developer:**
- [ ] Create "Reviewer Access" template in seed script
- [ ] Template: ReviewRelationship + reviewer role
- [ ] Required caveats: TimestampEnforcer, AllowedMethodsEnforcer
- [ ] On relationship confirm, auto-create delegation if template exists

### Sprint 3: Route Review Through DelegationManager
**Developer + Web3:**
- [ ] Build delegation for reviewer: delegator=agent, delegate=reviewer, caveats from template
- [ ] Sign delegation via DelegationManager
- [ ] Submit review via DelegationManager.redeemDelegation()
- [ ] Verify caveats enforce correctly (time + method)

### Sprint 4: Testing
**Tester + QA:**
- [ ] E2E: request reviewer relationship → confirm → submit review → verify on-chain
- [ ] Test expired delegation (should fail after 24h)
- [ ] Test wrong method selector (should fail)
- [ ] Test review without relationship (should fail)
- [ ] Test review with unconfirmed relationship (should fail)

## Contract Interactions

```
1. AgentRelationship.createEdge(reviewer, agent, ReviewRelationship, [reviewer])
2. AgentRelationship.setEdgeStatus(edgeId, CONFIRMED → ACTIVE)
3. DelegationManager.redeemDelegation(
     delegations: [{delegator: agent, delegate: reviewer, caveats: [...]}],
     target: AgentReviewRecord,
     value: 0,
     data: createReview(...)
   )
4. AgentReviewRecord.createReview(subject, type, rec, score, dimensions, comment, evidence)
```
