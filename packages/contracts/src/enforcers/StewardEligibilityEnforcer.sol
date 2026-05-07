// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../StewardEligibilityRegistry.sol";

/**
 * @title StewardEligibilityEnforcer
 * @notice Hats-style runtime eligibility check on stewards. A delegation
 *         that previously bound a fixed signer set now consults
 *         `StewardEligibilityRegistry` at sig-verification time, so a
 *         steward removed from the registry cannot redeem (without
 *         re-minting the STEWARDSHIP_DELEGATION).
 *
 * @dev terms = abi.encode(address pool, address registry)
 *      args  = abi.encode(address[] orderedSigners)
 *
 *      For every signer in `args`, require `registry.isEligible(pool, signer)`.
 *      The signer set itself is verified by `QuorumEnforcer` (which lives
 *      alongside this enforcer in the SESSION_DELEGATION caveat stack);
 *      this enforcer only validates that all currently-named signers are
 *      eligible *now* — independently of the original signer set baked
 *      into the delegation's QuorumEnforcer terms.
 *
 *      Pairing pattern: STEWARDSHIP_DELEGATION caveats include
 *        [AllowedTargetsEnforcer, AllowedMethodsEnforcer, PoolMandateEnforcer,
 *         StewardEligibilityEnforcer, TimestampEnforcer]
 *      The redeemer (lead steward) packs `args` containing the orderedSigners
 *      that contributed sigs to the AllocationDecided payload. If any
 *      signer is no longer eligible, the redeem reverts.
 */
contract StewardEligibilityEnforcer is ICaveatEnforcer {
    error StewardNotEligible(address signer);
    error InvalidTerms();

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
        (address pool, address registry) = abi.decode(terms, (address, address));
        if (pool == address(0) || registry == address(0)) revert InvalidTerms();
        address[] memory signers = abi.decode(args, (address[]));
        StewardEligibilityRegistry reg = StewardEligibilityRegistry(registry);
        for (uint256 i; i < signers.length; i++) {
            if (!reg.isEligible(pool, signers[i])) revert StewardNotEligible(signers[i]);
        }
    }

    function afterHook(
        bytes calldata, bytes calldata, bytes32,
        address, address, address, uint256, bytes calldata
    ) external pure override {}
}
