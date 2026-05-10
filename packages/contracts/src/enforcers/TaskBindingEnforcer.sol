// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title TaskBindingEnforcer
 * @notice Binds a sub-delegation to a specific A2A task identifier.
 *
 * @dev terms = abi.encode(bytes32 taskId)
 *
 *      This enforcer is INFORMATIONAL: it records the taskId in the
 *      delegation caveats so the off-chain audit layer can correlate a
 *      redeem to a specific A2A task. The on-chain `beforeHook` only
 *      validates the terms shape — it does NOT cross-check the taskId
 *      against any field of `callData`, because (a) the redeem's
 *      `callData` is the actual call to the target contract (e.g.
 *      `FundRegistry.setRoundStatus(...)`) and has no natural taskId
 *      slot, and (b) the caveat's terms are part of the delegation's
 *      EIP-712 hash, so the signer (a2a-agent's session key) cannot
 *      claim a different taskId than the one bound at mint time.
 *
 *      Cryptographic binding to the call itself comes from
 *      `CallDataHashEnforcer`. Pairing the two yields:
 *        - calldata is locked to one exact call (CallDataHashEnforcer)
 *        - the audit log records which A2A task that call belongs to
 *          (TaskBindingEnforcer terms; surfaced by `getTaskId`)
 *
 *      Off-chain, a2a-agent's `/session/:id/redeem-subdelegated` endpoint
 *      MUST refuse to mint a D_sub for a different taskId than the one
 *      in the inbound request — this is the off-chain half of the binding.
 */
contract TaskBindingEnforcer is ICaveatEnforcer {
    error BadTermsLength();

    /**
     * @notice Validates terms shape and is otherwise a no-op.
     * @dev Reverts only if the encoded terms are not exactly 32 bytes
     *      (i.e., not a single bytes32 taskId). Runtime binding to the
     *      call itself is the job of CallDataHashEnforcer, which is
     *      composed alongside this one in the sub-delegation caveats.
     */
    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        if (terms.length != 32) revert BadTermsLength();
    }

    function afterHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        // No post-execution check needed.
    }

    /**
     * @notice Decode the bound taskId from the caveat terms.
     * @dev Pure helper for off-chain readers (audit / observability).
     */
    function getTaskId(bytes calldata terms) external pure returns (bytes32) {
        if (terms.length != 32) revert BadTermsLength();
        return abi.decode(terms, (bytes32));
    }
}
