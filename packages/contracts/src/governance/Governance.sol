// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./IGovernance.sol";

/**
 * @title Governance
 * @notice N-of-M multisig + timelock with emergency pause. Implements the
 *         system-contracts upgrade authority described in SC4 (spec 007
 *         Phase A.5).
 *
 *         Substrate-independence rule P1: we do NOT depend on Safe /
 *         Aragon / DTK / Compound timelock at runtime. This is our own
 *         multisig, informed by but not dependent on those designs.
 *
 *         Properties:
 *           - Up to `maxMembers` signers, with a configurable threshold
 *             at construction.
 *           - Every proposal goes through a `Queued -> Executed` flow
 *             gated by a per-kind timelock.
 *           - Emergency pause is a separate, faster path that bypasses
 *             the timelock; it flips a single bool and grants NO
 *             upgrade authority.
 *           - Any signer can cancel a `Queued` proposal before exec.
 *           - Signer-set rotation goes through the same proposal flow
 *             (with its own timelock) — a captured signer cannot remove
 *             others before the rest can react.
 *
 *         Local-dev knob: the constructor accepts a `timelockSeconds`
 *         override so `fresh-start.sh` can spin up governance with a
 *         0-second timelock for fast e2e tests. Production deploys MUST
 *         set this to `MINIMUM_PROD_TIMELOCK` or higher; a non-zero
 *         delay below the minimum is rejected at construction.
 */
contract Governance is IGovernanceView {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Signer set ──────────────────────────────────────────────────

    mapping(address => bool) private _isSigner;
    uint256 public signerCount;
    uint256 public immutable threshold;
    uint256 public immutable maxMembers;

    // ─── Timelock ────────────────────────────────────────────────────

    /// @notice Production minimum delay. 0 is allowed at deploy ONLY when
    ///         `allowZeroTimelock` is set — used for local dev fast-path.
    uint256 public constant MINIMUM_PROD_TIMELOCK = 48 hours;

    /// @notice The actual configured timelock, set at construction.
    uint256 public immutable timelockSeconds;

    /// @notice Whether a 0-second timelock was explicitly allowed. Used
    ///         by tests to detect dev deploys.
    bool public immutable allowZeroTimelock;

    // ─── Proposals ────────────────────────────────────────────────────

    enum ProposalKind { None, Upgrade, AdminCall, SignerChange, Unpause }
    enum ProposalState { None, Queued, Executed, Cancelled }

    struct Proposal {
        ProposalKind kind;
        ProposalState state;
        address target;
        uint256 readyAt;
        uint256 approvals;
        bytes data;
    }

    mapping(bytes32 => Proposal) private _proposals;
    mapping(bytes32 => mapping(address => bool)) private _approvedBy;

    /// @notice Monotonic counter that disambiguates two otherwise-identical
    ///         proposals (same kind/target/data) when submitted within the
    ///         same block. Mixed into the proposal hash.
    uint256 public proposalNonce;

    // ─── Pause state ─────────────────────────────────────────────────

    bool private _paused;

    // ─── Events ──────────────────────────────────────────────────────

    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);

    event ProposalQueued(
        bytes32 indexed proposalId,
        ProposalKind kind,
        address indexed target,
        uint256 readyAt,
        address indexed proposer
    );
    event ProposalApproved(bytes32 indexed proposalId, address indexed signer, uint256 approvals);
    event ProposalExecuted(bytes32 indexed proposalId, bytes returnData);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed by);

    event PauseSet(bool paused);

    // ─── Errors ──────────────────────────────────────────────────────

    error NotSigner();
    error AlreadyApproved();
    error NotReady();
    error NotQueued();
    error ThresholdNotMet();
    error InvalidKind();
    error InvalidThreshold();
    error InvalidSignerCount();
    error ZeroSigner();
    error DuplicateSigner();
    error UnknownSigner();
    error AlreadySigner();
    error ExecFailed(bytes reason);
    error TimelockTooShort();
    error TimelockOutOfRange();
    error SignatureCountBelowThreshold();

    /**
     * @param initialSigners  Distinct EOAs forming the initial signer set.
     *                        Length is between `threshold_` and `maxMembers_`.
     * @param threshold_      Number of approvals required to execute.
     * @param maxMembers_     Hard cap on signers (cannot exceed this).
     * @param timelockSeconds_ Delay between approval-quorum and execute.
     *                        Must be either 0 (dev only) or
     *                        >= MINIMUM_PROD_TIMELOCK.
     * @param allowZeroTimelock_ True iff a 0-second timelock is permitted.
     */
    constructor(
        address[] memory initialSigners,
        uint256 threshold_,
        uint256 maxMembers_,
        uint256 timelockSeconds_,
        bool allowZeroTimelock_
    ) {
        if (threshold_ == 0) revert InvalidThreshold();
        if (maxMembers_ < threshold_) revert InvalidThreshold();
        if (initialSigners.length < threshold_) revert InvalidSignerCount();
        if (initialSigners.length > maxMembers_) revert InvalidSignerCount();

        if (timelockSeconds_ != 0 && timelockSeconds_ < MINIMUM_PROD_TIMELOCK) {
            revert TimelockOutOfRange();
        }
        if (timelockSeconds_ == 0 && !allowZeroTimelock_) {
            revert TimelockTooShort();
        }

        threshold = threshold_;
        maxMembers = maxMembers_;
        timelockSeconds = timelockSeconds_;
        allowZeroTimelock = allowZeroTimelock_;

        for (uint256 i = 0; i < initialSigners.length; i++) {
            address s = initialSigners[i];
            if (s == address(0)) revert ZeroSigner();
            if (_isSigner[s]) revert DuplicateSigner();
            _isSigner[s] = true;
            emit SignerAdded(s);
        }
        signerCount = initialSigners.length;
    }

    // ─── Views ────────────────────────────────────────────────────────

    /// @inheritdoc IGovernanceView
    function isPaused() external view override returns (bool) {
        return _paused;
    }

    /// @inheritdoc IGovernanceView
    function isSigner(address who) external view override returns (bool) {
        return _isSigner[who];
    }

    function getProposal(bytes32 proposalId)
        external
        view
        returns (
            ProposalKind kind,
            ProposalState state,
            address target,
            uint256 readyAt,
            uint256 approvals,
            bytes memory data
        )
    {
        Proposal storage p = _proposals[proposalId];
        return (p.kind, p.state, p.target, p.readyAt, p.approvals, p.data);
    }

    function hasApproved(bytes32 proposalId, address who) external view returns (bool) {
        return _approvedBy[proposalId][who];
    }

    // ─── Proposal flow ───────────────────────────────────────────────

    /// @notice Queue a new proposal. The first signer to call this also
    ///         contributes the first approval.
    function propose(
        ProposalKind kind,
        address target,
        bytes calldata data
    ) external returns (bytes32 proposalId) {
        if (!_isSigner[msg.sender]) revert NotSigner();
        if (kind == ProposalKind.None) revert InvalidKind();

        uint256 nonce = ++proposalNonce;
        proposalId = keccak256(abi.encode(kind, target, data, nonce, address(this), block.chainid));

        Proposal storage p = _proposals[proposalId];
        // Defence-in-depth: proposalId uniqueness comes from `nonce`; this
        // line is unreachable in normal use but cheap to keep.
        if (p.state != ProposalState.None) revert NotQueued();

        p.kind = kind;
        p.state = ProposalState.Queued;
        p.target = target;
        p.data = data;
        p.readyAt = block.timestamp + timelockSeconds;
        p.approvals = 1;
        _approvedBy[proposalId][msg.sender] = true;

        emit ProposalQueued(proposalId, kind, target, p.readyAt, msg.sender);
        emit ProposalApproved(proposalId, msg.sender, 1);
    }

    /// @notice Approve a queued proposal. Each signer can approve once.
    function approve(bytes32 proposalId) external {
        if (!_isSigner[msg.sender]) revert NotSigner();
        Proposal storage p = _proposals[proposalId];
        if (p.state != ProposalState.Queued) revert NotQueued();
        if (_approvedBy[proposalId][msg.sender]) revert AlreadyApproved();
        _approvedBy[proposalId][msg.sender] = true;
        p.approvals += 1;
        emit ProposalApproved(proposalId, msg.sender, p.approvals);
    }

    /// @notice Execute a queued proposal after timelock and quorum.
    ///         Permissionless — once both gates are satisfied, anyone
    ///         can pay gas to push the proposal through.
    function execute(bytes32 proposalId) external returns (bytes memory ret) {
        Proposal storage p = _proposals[proposalId];
        if (p.state != ProposalState.Queued) revert NotQueued();
        if (p.approvals < threshold) revert ThresholdNotMet();
        if (block.timestamp < p.readyAt) revert NotReady();

        p.state = ProposalState.Executed;

        if (p.kind == ProposalKind.SignerChange) {
            _applySignerChange(p.data);
            emit ProposalExecuted(proposalId, "");
            return "";
        }
        if (p.kind == ProposalKind.Unpause) {
            _paused = false;
            emit PauseSet(false);
            emit ProposalExecuted(proposalId, "");
            return "";
        }

        // Upgrade / AdminCall fall through to a raw call against `target`.
        bool ok;
        (ok, ret) = p.target.call(p.data);
        if (!ok) revert ExecFailed(ret);
        emit ProposalExecuted(proposalId, ret);
    }

    /// @notice Cancel a queued proposal. Any signer may cancel during
    ///         the timelock window; this is the user-facing exit valve
    ///         if a proposal turns out to be hostile.
    function cancel(bytes32 proposalId) external {
        if (!_isSigner[msg.sender]) revert NotSigner();
        Proposal storage p = _proposals[proposalId];
        if (p.state != ProposalState.Queued) revert NotQueued();
        p.state = ProposalState.Cancelled;
        emit ProposalCancelled(proposalId, msg.sender);
    }

    // ─── Emergency pause ─────────────────────────────────────────────

    /// @notice Flip the pause flag immediately, given `threshold` valid
    ///         signatures over the EMERGENCY_PAUSE digest. Unpause goes
    ///         through the normal `Unpause` proposal flow (with timelock).
    /// @param signatures Concatenated 65-byte ECDSA signatures, each
    ///                   signed by a distinct active signer over
    ///                   `keccak256(abi.encode("EMERGENCY_PAUSE",
    ///                   address(this), block.chainid, pauseNonce))`.
    /// @dev `pauseNonce` is the next-to-use `proposalNonce` value AT THE
    ///       TIME OF SIGNING; the caller passes it in `nonce` so the
    ///       contract can re-derive the digest. Each pause invocation
    ///       advances the nonce so old signatures cannot be replayed.
    function emergencyPause(uint256 nonce, bytes calldata signatures) external {
        // Bind the digest to a specific nonce so a pause-bundle cannot
        // be replayed after an unpause.
        bytes32 digest = keccak256(
            abi.encode(
                bytes32("EMERGENCY_PAUSE"),
                address(this),
                block.chainid,
                nonce
            )
        );
        require(nonce == proposalNonce + 1, "stale pause nonce");

        uint256 count = _countValidSignatures(digest, signatures);
        if (count < threshold) revert SignatureCountBelowThreshold();

        // Burn the nonce so this bundle cannot be replayed.
        ++proposalNonce;

        if (!_paused) {
            _paused = true;
            emit PauseSet(true);
        }
    }

    // ─── Internals ───────────────────────────────────────────────────

    function _applySignerChange(bytes memory data) internal {
        // SignerChange payload: (address oldSigner, address newSigner).
        // Either may be zero — zero `oldSigner` is "pure addition";
        // zero `newSigner` is "pure removal". Both non-zero is a swap.
        (address oldSigner, address newSigner) = abi.decode(data, (address, address));

        if (oldSigner != address(0)) {
            if (!_isSigner[oldSigner]) revert UnknownSigner();
            _isSigner[oldSigner] = false;
            signerCount -= 1;
            emit SignerRemoved(oldSigner);
        }
        if (newSigner != address(0)) {
            if (_isSigner[newSigner]) revert AlreadySigner();
            _isSigner[newSigner] = true;
            signerCount += 1;
            emit SignerAdded(newSigner);
        }
        // Post-change invariants: at least `threshold` signers, at most
        // `maxMembers`.
        if (signerCount < threshold) revert InvalidSignerCount();
        if (signerCount > maxMembers) revert InvalidSignerCount();
    }

    /// @dev Counts how many distinct active signers signed `digest`.
    ///      `signatures` is the concatenation of 65-byte ECDSA sigs.
    ///      Duplicate signers in the bundle count once. Invalid sigs
    ///      and non-signers are silently ignored.
    function _countValidSignatures(bytes32 digest, bytes calldata signatures)
        internal
        view
        returns (uint256 count)
    {
        if (signatures.length % 65 != 0) return 0;
        uint256 n = signatures.length / 65;
        address[] memory seen = new address[](n);

        bytes32 ethSigned = digest.toEthSignedMessageHash();

        for (uint256 i = 0; i < n; i++) {
            bytes memory sig = signatures[i * 65:(i + 1) * 65];

            // Try raw digest first then eth-signed wrap — mirrors the
            // AgentAccount._verifyEcdsa precedent.
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
            if (err != ECDSA.RecoverError.NoError || !_isSigner[recovered]) {
                (recovered, err,) = ECDSA.tryRecover(ethSigned, sig);
                if (err != ECDSA.RecoverError.NoError || !_isSigner[recovered]) {
                    continue;
                }
            }

            bool dup = false;
            for (uint256 j = 0; j < count; j++) {
                if (seen[j] == recovered) { dup = true; break; }
            }
            if (!dup) {
                seen[count] = recovered;
                count += 1;
            }
        }
    }
}
