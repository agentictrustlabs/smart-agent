// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

/**
 * @title CommitmentRegistry
 * @notice Universal post-match artifact (spec-006). Any path that pairs a
 *         NeedIntent with resources — grant award (spec-003), direct
 *         intent match (spec-001 MatchInitiation), pool pledge acceptance
 *         (spec-002 PoolPledge) — creates a `sa:Commitment` row here.
 *         The commitment carries fulfillment terms (milestones + tranche
 *         schedule), moves USDC from donor → recipient as milestones are
 *         released, and records outcome attestations against the
 *         original need.
 *
 * Subject = `keccak256("sa:commitment:", sourceKind, sourceSubject, donor)`.
 * One commitment per (source artifact, donor) — co-funding produces
 * distinct commitments sharing the same sourceSubject.
 *
 * Auth (donor-side writes — commit / cancel / setDonor / setRecipient):
 * the commitment's `donor` AgentAccount is the writer. msg.sender must be
 * an `isOwner` of that account. Spec-006 makes this the universal pattern
 * — pool steward for grant + pool-pledge lanes, offerer for direct lane.
 *
 * Auth (recordRelease): msg.sender must equal the recorded donor address
 * (the AgentAccount whose `executeBatch` paired the USDC transfer with
 * this call). Mirrors PledgeRegistry.recordHonor's `msg.sender == treasury`
 * gate — same-tx transfer is the proof, the chain doesn't re-verify.
 *
 * Auth (recordOutcome): permissionless on chain. Validator eligibility is
 * established OFF chain by org-mcp via an AnonCreds ValidatorCredential
 * presentation before issuing the redeem. Mirrors VoteRegistry.castVote.
 */
contract CommitmentRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_COMMITMENT = keccak256("sa:Commitment");

    // ─── Source-kind enum (bytes32) ─────────────────────────────────
    // Stored at SA_COMMITMENT_SOURCE_KIND. Extension = add a new keccak
    // constant in the next spec, no contract change required.
    bytes32 public constant SOURCE_AWARD       = keccak256("sa:CommitmentSourceAward");
    bytes32 public constant SOURCE_DIRECT      = keccak256("sa:CommitmentSourceDirectMatch");
    bytes32 public constant SOURCE_POOL_PLEDGE = keccak256("sa:CommitmentSourcePoolPledge");

    // ─── Status enum (bytes32) ──────────────────────────────────────
    bytes32 public constant STATUS_PENDING            = keccak256("sa:CommitmentPending");
    bytes32 public constant STATUS_IN_FLIGHT          = keccak256("sa:CommitmentInFlight");
    bytes32 public constant STATUS_COMPLETED          = keccak256("sa:CommitmentCompleted");
    bytes32 public constant STATUS_CANCELED           = keccak256("sa:CommitmentCanceled");
    bytes32 public constant STATUS_RELEASES_BLOCKED   = keccak256("sa:CommitmentReleasesBlocked");

    // ─── Predicates ─────────────────────────────────────────────────
    // Lineage / context.
    bytes32 public constant SA_COMMITMENT_SOURCE_KIND     = keccak256("sa:commitmentSourceKind");
    bytes32 public constant SA_COMMITMENT_SOURCE_SUBJECT  = keccak256("sa:commitmentSourceSubject");
    bytes32 public constant SA_COMMITMENT_ROUND           = keccak256("sa:commitmentRound");
    bytes32 public constant SA_COMMITMENT_NEED_INTENT     = keccak256("sa:commitmentNeedIntent");
    bytes32 public constant SA_COMMITMENT_OFFER_INTENT    = keccak256("sa:commitmentOfferIntent");

    // Parties.
    bytes32 public constant SA_COMMITMENT_DONOR     = keccak256("sa:commitmentDonor");
    bytes32 public constant SA_COMMITMENT_RECIPIENT = keccak256("sa:commitmentRecipient");

    // Terms.
    bytes32 public constant SA_COMMITMENT_TOKEN           = keccak256("sa:commitmentToken");
    bytes32 public constant SA_COMMITMENT_TOTAL_AMOUNT    = keccak256("sa:commitmentTotalAmount");
    bytes32 public constant SA_COMMITMENT_MILESTONES_JSON = keccak256("sa:commitmentMilestonesJson");

    // State.
    bytes32 public constant SA_COMMITMENT_RELEASED_AMOUNT = keccak256("sa:commitmentReleasedAmount");
    bytes32 public constant SA_COMMITMENT_STATUS          = keccak256("sa:commitmentStatus");
    bytes32 public constant SA_COMMITMENT_COMMITTED_AT    = keccak256("sa:commitmentCommittedAt");
    bytes32 public constant SA_COMMITMENT_UPDATED_AT      = keccak256("sa:commitmentUpdatedAt");
    bytes32 public constant SA_COMMITMENT_CANCEL_REASON   = keccak256("sa:commitmentCancelReason");

    // Per-milestone state — composite subject pattern
    // (commitment, "milestone", milestoneId).
    bytes32 public constant SA_MILESTONE_RELEASED    = keccak256("sa:milestoneReleased");    // uint, 0/totalForMilestone
    bytes32 public constant SA_MILESTONE_RELEASED_AT = keccak256("sa:milestoneReleasedAt");  // uint, block.timestamp

    // Per-outcome attestation — composite subject pattern
    // (commitment, "outcome", outcomeId).
    bytes32 public constant SA_OUTCOME_EVIDENCE_HASH  = keccak256("sa:outcomeEvidenceHash");
    bytes32 public constant SA_OUTCOME_RECORDED_AT    = keccak256("sa:outcomeRecordedAt");
    bytes32 public constant SA_OUTCOME_RECORDED_BY    = keccak256("sa:outcomeRecordedBy");

    // ─── Errors ─────────────────────────────────────────────────────
    error NotDonorOwner();
    error NotDonor();
    error CommitmentNotFound();
    error CommitmentNotActive();
    error InvalidSourceKind();
    error InvalidToken();
    error ZeroAmount();
    error ReleaseExceedsTotal();
    error MilestoneAlreadyReleased();
    error MissingNeedIntent();

    // ─── Events ─────────────────────────────────────────────────────
    event Committed(
        bytes32 indexed commitmentSubject,
        bytes32 indexed sourceKind,
        bytes32 indexed sourceSubject,
        address donor,
        address recipient,
        uint256 totalAmount,
        bytes32 status
    );
    event Released(
        bytes32 indexed commitmentSubject,
        bytes32 indexed milestoneId,
        address indexed recipient,
        uint256 amount,
        uint256 totalReleased
    );
    event OutcomeRecorded(
        bytes32 indexed commitmentSubject,
        bytes32 indexed outcomeId,
        bytes32 evidenceHash,
        address recordedBy
    );
    event Completed(bytes32 indexed commitmentSubject, uint256 totalReleased);
    event Canceled(bytes32 indexed commitmentSubject, bytes32 reasonHash);
    event DonorResolved(bytes32 indexed commitmentSubject, address newDonor);
    event RecipientResolved(bytes32 indexed commitmentSubject, address newRecipient);

    struct CommitParams {
        bytes32 sourceKind;
        bytes32 sourceSubject;
        bytes32 round;          // 0x0 if not applicable (direct lane)
        address donor;          // AgentAccount that releases funds
        address recipient;      // Resolved treasury; 0x0 → status = ReleasesBlocked
        address token;          // ERC-20 (MockUSDC dev / USDC mainnet)
        uint256 totalAmount;
        string  needIntentId;
        string  offerIntentId;
        string  milestonesJson;
    }

    constructor(address ontologyRegistry, address shapes)
        AttributeStorage(ontologyRegistry)
    {
        SHAPES = ShapeRegistry(shapes);
    }

    function _commitmentSubject(
        bytes32 sourceKind,
        bytes32 sourceSubject,
        address donor
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("sa:commitment:", sourceKind, sourceSubject, donor));
    }

    function commitmentSubject(
        bytes32 sourceKind,
        bytes32 sourceSubject,
        address donor
    ) external pure returns (bytes32) {
        return _commitmentSubject(sourceKind, sourceSubject, donor);
    }

    function _milestoneSubject(bytes32 commitmentSubj, bytes32 milestoneId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(commitmentSubj, "milestone", milestoneId));
    }

    function _outcomeSubject(bytes32 commitmentSubj, bytes32 outcomeId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(commitmentSubj, "outcome", outcomeId));
    }

    function _isAccountOwner(address account, address actor) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", actor)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    function _isKnownSourceKind(bytes32 kind) internal pure returns (bool) {
        return kind == SOURCE_AWARD || kind == SOURCE_DIRECT || kind == SOURCE_POOL_PLEDGE;
    }

    /// @notice Create a commitment. Donor's owner must call.
    /// @dev If `recipient` is zero, the commitment lands as
    ///      ReleasesBlocked and must be unblocked via `setRecipient` before
    ///      any tranche release can succeed. Same applies if donor is zero
    ///      (resolved later via `setDonor`), though in practice the donor
    ///      must be live at commit time because msg.sender has to own it.
    function commit(CommitParams calldata p) external {
        if (!_isKnownSourceKind(p.sourceKind)) revert InvalidSourceKind();
        if (p.token == address(0)) revert InvalidToken();
        if (p.totalAmount == 0) revert ZeroAmount();
        if (bytes(p.needIntentId).length == 0) revert MissingNeedIntent();
        if (p.donor == address(0) || !_isAccountOwner(p.donor, msg.sender)) {
            revert NotDonorOwner();
        }

        bytes32 subj = _commitmentSubject(p.sourceKind, p.sourceSubject, p.donor);

        _setBytes32(subj, SA_COMMITMENT_SOURCE_KIND, p.sourceKind);
        _setBytes32(subj, SA_COMMITMENT_SOURCE_SUBJECT, p.sourceSubject);
        if (p.round != bytes32(0)) {
            _setBytes32(subj, SA_COMMITMENT_ROUND, p.round);
        }
        _setString(subj, SA_COMMITMENT_NEED_INTENT, p.needIntentId);
        if (bytes(p.offerIntentId).length > 0) {
            _setString(subj, SA_COMMITMENT_OFFER_INTENT, p.offerIntentId);
        }
        _setAddress(subj, SA_COMMITMENT_DONOR, p.donor);
        _setAddress(subj, SA_COMMITMENT_RECIPIENT, p.recipient);
        _setAddress(subj, SA_COMMITMENT_TOKEN, p.token);
        _setUint(subj, SA_COMMITMENT_TOTAL_AMOUNT, p.totalAmount);
        _setString(subj, SA_COMMITMENT_MILESTONES_JSON, p.milestonesJson);
        _setUint(subj, SA_COMMITMENT_RELEASED_AMOUNT, 0);
        _setUint(subj, SA_COMMITMENT_COMMITTED_AT, block.timestamp);
        _setUint(subj, SA_COMMITMENT_UPDATED_AT, block.timestamp);

        bytes32 initialStatus = p.recipient == address(0) ? STATUS_RELEASES_BLOCKED : STATUS_PENDING;
        _setBytes32(subj, SA_COMMITMENT_STATUS, initialStatus);

        SHAPES.validateSubject(CLASS_COMMITMENT, subj, address(this));
        emit Committed(subj, p.sourceKind, p.sourceSubject, p.donor, p.recipient, p.totalAmount, initialStatus);
    }

    /// @notice Record a tranche release. Must be called from inside an
    ///         `AgentAccount.executeBatch` whose paired call is
    ///         `token.transfer(recipient, amount)`. msg.sender must equal
    ///         the commitment's donor (= the AgentAccount that issued the
    ///         transfer). Mirrors PledgeRegistry.recordHonor.
    function recordRelease(
        bytes32 commitmentSubj,
        bytes32 milestoneId,
        uint256 amount
    ) external {
        if (!this.isSet(commitmentSubj, SA_COMMITMENT_DONOR)) revert CommitmentNotFound();
        bytes32 status = this.getBytes32(commitmentSubj, SA_COMMITMENT_STATUS);
        if (status == STATUS_CANCELED || status == STATUS_COMPLETED || status == STATUS_RELEASES_BLOCKED) {
            revert CommitmentNotActive();
        }
        address donor = this.getAddress(commitmentSubj, SA_COMMITMENT_DONOR);
        if (msg.sender != donor) revert NotDonor();
        if (amount == 0) revert ZeroAmount();

        // Per-milestone idempotency — a milestone can be released exactly once.
        bytes32 ms = _milestoneSubject(commitmentSubj, milestoneId);
        if (this.isSet(ms, SA_MILESTONE_RELEASED)) revert MilestoneAlreadyReleased();

        uint256 total = this.getUint(commitmentSubj, SA_COMMITMENT_TOTAL_AMOUNT);
        uint256 prev = this.getUint(commitmentSubj, SA_COMMITMENT_RELEASED_AMOUNT);
        uint256 next = prev + amount;
        if (next > total) revert ReleaseExceedsTotal();

        _setUint(ms, SA_MILESTONE_RELEASED, amount);
        _setUint(ms, SA_MILESTONE_RELEASED_AT, block.timestamp);
        _setUint(commitmentSubj, SA_COMMITMENT_RELEASED_AMOUNT, next);
        _setUint(commitmentSubj, SA_COMMITMENT_UPDATED_AT, block.timestamp);

        // Status transitions:
        //   Pending → InFlight on first release
        //   InFlight → Completed on full disbursal
        if (next < total) {
            if (status == STATUS_PENDING) {
                _setBytes32(commitmentSubj, SA_COMMITMENT_STATUS, STATUS_IN_FLIGHT);
            }
        } else {
            _setBytes32(commitmentSubj, SA_COMMITMENT_STATUS, STATUS_COMPLETED);
            emit Completed(commitmentSubj, next);
        }

        address recipient = this.getAddress(commitmentSubj, SA_COMMITMENT_RECIPIENT);
        emit Released(commitmentSubj, milestoneId, recipient, amount, next);
    }

    /// @notice Record an outcome attestation. Permissionless on chain;
    ///         validator gating happens off-chain via AnonCreds before the
    ///         redeem reaches us. evidenceHash is the sha256 of the
    ///         evidence document stored in org-mcp / person-mcp.
    function recordOutcome(
        bytes32 commitmentSubj,
        bytes32 outcomeId,
        bytes32 evidenceHash
    ) external {
        if (!this.isSet(commitmentSubj, SA_COMMITMENT_DONOR)) revert CommitmentNotFound();
        bytes32 ou = _outcomeSubject(commitmentSubj, outcomeId);
        _setBytes32(ou, SA_OUTCOME_EVIDENCE_HASH, evidenceHash);
        _setUint(ou, SA_OUTCOME_RECORDED_AT, block.timestamp);
        _setAddress(ou, SA_OUTCOME_RECORDED_BY, msg.sender);
        emit OutcomeRecorded(commitmentSubj, outcomeId, evidenceHash, msg.sender);
    }

    /// @notice Cancel an unfinished commitment. Donor-owner only.
    ///         Undisbursed funds stay with the donor (v1 — pro-rata refund
    ///         to original pledgers is deferred).
    function cancelCommitment(bytes32 commitmentSubj, bytes32 reasonHash) external {
        address donor = this.getAddress(commitmentSubj, SA_COMMITMENT_DONOR);
        if (donor == address(0)) revert CommitmentNotFound();
        if (!_isAccountOwner(donor, msg.sender)) revert NotDonorOwner();
        bytes32 status = this.getBytes32(commitmentSubj, SA_COMMITMENT_STATUS);
        if (status == STATUS_COMPLETED || status == STATUS_CANCELED) revert CommitmentNotActive();
        _setBytes32(commitmentSubj, SA_COMMITMENT_STATUS, STATUS_CANCELED);
        _setBytes32(commitmentSubj, SA_COMMITMENT_CANCEL_REASON, reasonHash);
        _setUint(commitmentSubj, SA_COMMITMENT_UPDATED_AT, block.timestamp);
        emit Canceled(commitmentSubj, reasonHash);
    }

    /// @notice Resolve a previously unset/zero recipient. Donor-owner only.
    ///         Unblocks the commitment when recipient flips from zero to
    ///         a real address.
    function setRecipient(bytes32 commitmentSubj, address newRecipient) external {
        address donor = this.getAddress(commitmentSubj, SA_COMMITMENT_DONOR);
        if (donor == address(0)) revert CommitmentNotFound();
        if (!_isAccountOwner(donor, msg.sender)) revert NotDonorOwner();
        if (newRecipient == address(0)) revert NotDonorOwner();
        _setAddress(commitmentSubj, SA_COMMITMENT_RECIPIENT, newRecipient);
        bytes32 status = this.getBytes32(commitmentSubj, SA_COMMITMENT_STATUS);
        if (status == STATUS_RELEASES_BLOCKED) {
            _setBytes32(commitmentSubj, SA_COMMITMENT_STATUS, STATUS_PENDING);
        }
        _setUint(commitmentSubj, SA_COMMITMENT_UPDATED_AT, block.timestamp);
        emit RecipientResolved(commitmentSubj, newRecipient);
    }

    /// @notice Reassign donor when the original donor needs migrating
    ///         (rare; e.g. wallet rotation). Current donor-owner only.
    function setDonor(bytes32 commitmentSubj, address newDonor) external {
        address donor = this.getAddress(commitmentSubj, SA_COMMITMENT_DONOR);
        if (donor == address(0)) revert CommitmentNotFound();
        if (!_isAccountOwner(donor, msg.sender)) revert NotDonorOwner();
        if (newDonor == address(0)) revert NotDonorOwner();
        _setAddress(commitmentSubj, SA_COMMITMENT_DONOR, newDonor);
        _setUint(commitmentSubj, SA_COMMITMENT_UPDATED_AT, block.timestamp);
        emit DonorResolved(commitmentSubj, newDonor);
    }

    // ─── View helpers ───────────────────────────────────────────────

    function getCommitment(bytes32 commitmentSubj)
        external
        view
        returns (
            bytes32 sourceKind,
            bytes32 sourceSubject,
            address donor,
            address recipient,
            address token,
            uint256 totalAmount,
            uint256 releasedAmount,
            bytes32 status
        )
    {
        sourceKind     = this.getBytes32(commitmentSubj, SA_COMMITMENT_SOURCE_KIND);
        sourceSubject  = this.getBytes32(commitmentSubj, SA_COMMITMENT_SOURCE_SUBJECT);
        donor          = this.getAddress(commitmentSubj, SA_COMMITMENT_DONOR);
        recipient      = this.getAddress(commitmentSubj, SA_COMMITMENT_RECIPIENT);
        token          = this.getAddress(commitmentSubj, SA_COMMITMENT_TOKEN);
        totalAmount    = this.getUint(commitmentSubj, SA_COMMITMENT_TOTAL_AMOUNT);
        releasedAmount = this.getUint(commitmentSubj, SA_COMMITMENT_RELEASED_AMOUNT);
        status         = this.getBytes32(commitmentSubj, SA_COMMITMENT_STATUS);
    }

    function getMilestoneRelease(bytes32 commitmentSubj, bytes32 milestoneId)
        external
        view
        returns (uint256 amount, uint256 releasedAt)
    {
        bytes32 ms = _milestoneSubject(commitmentSubj, milestoneId);
        if (this.isSet(ms, SA_MILESTONE_RELEASED)) {
            amount = this.getUint(ms, SA_MILESTONE_RELEASED);
        }
        if (this.isSet(ms, SA_MILESTONE_RELEASED_AT)) {
            releasedAt = this.getUint(ms, SA_MILESTONE_RELEASED_AT);
        }
    }

    function getOutcome(bytes32 commitmentSubj, bytes32 outcomeId)
        external
        view
        returns (bytes32 evidenceHash, uint256 recordedAt, address recordedBy)
    {
        bytes32 ou = _outcomeSubject(commitmentSubj, outcomeId);
        if (this.isSet(ou, SA_OUTCOME_EVIDENCE_HASH)) {
            evidenceHash = this.getBytes32(ou, SA_OUTCOME_EVIDENCE_HASH);
        }
        if (this.isSet(ou, SA_OUTCOME_RECORDED_AT)) {
            recordedAt = this.getUint(ou, SA_OUTCOME_RECORDED_AT);
        }
        if (this.isSet(ou, SA_OUTCOME_RECORDED_BY)) {
            recordedBy = this.getAddress(ou, SA_OUTCOME_RECORDED_BY);
        }
    }
}
