// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title RoundDecisionWindowEnforcer
 * @notice Disbursement userOps are valid only after the decision window
 *         (oSnap-style 72h dispute period after AllocationDecided) closes,
 *         AND only against recipients on the awarded list.
 *
 * @dev terms = abi.encode(
 *        bytes32 roundId,
 *        uint256 disputeUntil,   // block.timestamp >= disputeUntil required
 *        bytes32 awardsRoot      // Merkle root over (proposalIRIhash || recipient || totalAmount)
 *      )
 *
 *      args = abi.encode(
 *        bytes32 proposalIRIHash,
 *        address recipient,
 *        uint256 totalAmount,
 *        bytes32[] proof
 *      )
 *
 *      The leaf is `keccak256(abi.encodePacked(proposalIRIHash, recipient, totalAmount))` —
 *      tying together the public allocation outcome to the recipient and
 *      total expected. This means the awardsRoot commits to the FULL award
 *      (not per-tranche), so when AllocationLimitEnforcer caps a tranche at
 *      `trancheCap < totalAmount` it does so as a separate concern.
 *
 *      Per-call usage: the steward's session signer constructs `args` with
 *      a Merkle proof against the awardsRoot committed at AllocationDecided
 *      time. RoundDecisionWindowEnforcer doesn't itself read any registry —
 *      the proof IS the link to the AllocationDecided assertion.
 */
contract RoundDecisionWindowEnforcer is ICaveatEnforcer {
    error TooEarly(uint256 nowTs, uint256 disputeUntil);
    error NotInAwardsList();

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32, // delegationHash
        address, // delegator
        address, // redeemer
        address, // target
        uint256, // value
        bytes calldata // callData
    ) external view override {
        (
            , // roundId — passed to args check downstream / off-chain
            uint256 disputeUntil,
            bytes32 awardsRoot
        ) = abi.decode(terms, (bytes32, uint256, bytes32));
        if (block.timestamp < disputeUntil) revert TooEarly(block.timestamp, disputeUntil);

        (
            bytes32 proposalIRIHash,
            address recipient,
            uint256 totalAmount,
            bytes32[] memory proof
        ) = abi.decode(args, (bytes32, address, uint256, bytes32[]));

        bytes32 leaf = keccak256(abi.encodePacked(proposalIRIHash, recipient, totalAmount));
        if (!_verify(proof, awardsRoot, leaf)) revert NotInAwardsList();
    }

    function afterHook(
        bytes calldata, bytes calldata, bytes32,
        address, address, address, uint256, bytes calldata
    ) external pure override {}

    function _verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i; i < proof.length; i++) {
            bytes32 sib = proof[i];
            computed = computed < sib
                ? keccak256(abi.encodePacked(computed, sib))
                : keccak256(abi.encodePacked(sib, computed));
        }
        return computed == root;
    }
}
