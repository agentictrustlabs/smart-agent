# ERC-8004 Feedback Alignment — PM Spec

## Key Concepts from ERC-8004 ReputationRegistry

The ERC-8004 ReputationRegistry has several capabilities our `AgentReviewRecord` lacks:

### 1. Signed Numeric Value with Decimals
ERC-8004 uses `int128 value` + `uint8 valueDecimals` — allowing both positive AND negative feedback with decimal precision (e.g., -0.5, +3.75).

**Our current:** `uint8 overallScore` (0-100 unsigned integer). No negative values, no decimal precision.

**Recommendation:** Add signed value support. A reviewer should be able to give negative feedback (e.g., -1 for harmful behavior). Keep our 0-100 dimension scores but add a signed primary value.

### 2. Tag-Based Categorization
ERC-8004 uses `tag1` + `tag2` (string tags) instead of enum types. Tags are indexed for filtering. `getSummary()` filters by tags.

**Our current:** `bytes32 reviewType` and `bytes32 recommendation` (hashed enums).

**Recommendation:** Add free-form tags alongside our typed categories. Tags enable community-driven categorization without contract upgrades.

### 3. Responses / Rebuttals
ERC-8004 has `appendResponse()` — the agent (or anyone) can respond to feedback with a `responseURI` + `responseHash`. Multiple responses per feedback. Tracked by responder address.

**Our current:** No response mechanism. Reviews are one-way.

**Recommendation:** Add response capability. Agent owners should be able to respond to reviews with explanations, corrections, or rebuttals.

### 4. Anti-Self-Feedback
ERC-8004 prevents agent owners/operators from giving themselves feedback:
```solidity
require(!IIdentityRegistry(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId), "Self-feedback not allowed");
```

**Our current:** No self-feedback prevention. An agent owner could review their own agent.

**Recommendation:** Check that reviewer is NOT an owner of the subject agent.

### 5. Feedback URI + Hash
ERC-8004 stores `feedbackURI` (off-chain content) + `feedbackHash` (integrity proof). This allows rich feedback content (PDFs, detailed reports) with on-chain verifiability.

**Our current:** `comment` (string) and `evidenceURI` (string) but no hash.

**Recommendation:** Add content hash for verifiable off-chain evidence.

### 6. Summary/Aggregation
ERC-8004 has `getSummary()` that computes averages filtered by tags, handling decimal normalization.

**Our current:** `getAverageScore()` returns simple average of overallScore.

**Recommendation:** Add tag-filtered summary. Support decimal-precision aggregation.

### 7. Client Tracking
ERC-8004 tracks all unique clients (reviewers) per agent via `getClients()`.

**Our current:** We track by reviewer address but don't have a dedicated `getReviewers()` function.

**Recommendation:** Add `getReviewers(subject)` function.

### 8. Endpoint Tracking
ERC-8004 records which `endpoint` the feedback is about (e.g., specific API endpoint, tool, or service).

**Our current:** No endpoint-level feedback. All feedback is agent-level.

**Recommendation:** Add optional `endpoint` or `context` field. Allows feedback on specific agent capabilities/tools.

## Implementation Plan

### Sprint 1: Add Response Capability
- [ ] Add `appendResponse(uint256 reviewId, string responseURI, bytes32 responseHash)` to AgentReviewRecord
- [ ] Track responders per review
- [ ] Web app: "Respond" button on reviews for agent owners
- [ ] Display responses inline with reviews

### Sprint 2: Anti-Self-Feedback + Tags
- [ ] Check reviewer ≠ subject owner in `createReview()`
- [ ] Add `tag1` and `tag2` string fields to Review struct
- [ ] Add `endpoint` field for context-specific feedback
- [ ] `getSummaryByTag()` function for filtered aggregation

### Sprint 3: Signed Values + Content Hash
- [ ] Add `int128 signedValue` + `uint8 valueDecimals` alongside overallScore
- [ ] Add `bytes32 feedbackHash` for verifiable off-chain content
- [ ] Update web app review form with sign toggle

### Sprint 4: Aggregation Improvements
- [ ] `getReviewers(address subject)` → unique reviewer list
- [ ] Tag-filtered summary with decimal normalization
- [ ] `readAllFeedback()` with tag filters and includeRevoked flag
