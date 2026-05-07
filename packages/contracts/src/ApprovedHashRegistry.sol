// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ApprovedHashRegistry
 * @notice On-chain pre-approved hashes — the v=1 path of Safe-style
 *         signature verification. Lets passkey-only stewards (whose
 *         AgentAccount can't easily produce off-chain ECDSA over arbitrary
 *         EIP-712 payloads) pre-approve an `AllocationDecided` hash by tx,
 *         rather than signing off-chain.
 *
 * @dev Mirrors Safe's `Safe.approveHash` semantics. `QuorumEnforcer.beforeHook`
 *      consults `isApproved(signer, hash)` when it sees a sig with `v=1`.
 *
 *      Anyone may approve their own hashes; the verifier (QuorumEnforcer)
 *      only counts approvals from addresses present in the steward eligibility
 *      set, so spam-approvals from non-stewards are no-ops.
 */
contract ApprovedHashRegistry {
    /// signer => hash => approved
    mapping(address => mapping(bytes32 => bool)) public approved;

    event HashApproved(address indexed signer, bytes32 indexed hash);
    event HashRevoked(address indexed signer, bytes32 indexed hash);

    /**
     * @notice Pre-approve a hash. `msg.sender` is the signer; only this
     *         address can later be counted by QuorumEnforcer for this hash.
     */
    function approveHash(bytes32 hash) external {
        approved[msg.sender][hash] = true;
        emit HashApproved(msg.sender, hash);
    }

    /// @notice Revoke a previously-approved hash before redemption.
    function revokeHash(bytes32 hash) external {
        approved[msg.sender][hash] = false;
        emit HashRevoked(msg.sender, hash);
    }

    /// @notice External view used by QuorumEnforcer's v=1 path.
    function isApproved(address signer, bytes32 hash) external view returns (bool) {
        return approved[signer][hash];
    }
}
