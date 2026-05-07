// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../MandateRegistry.sol";

/**
 * @title PoolMandateEnforcer
 * @notice Restricts a delegated disbursement to recipients whose target
 *         intent / proposal kind + geo are inside the Pool's mandate roots.
 *
 * @dev terms = abi.encode(address pool, address mandateRegistry)
 *
 *      args = abi.encode(
 *          bytes32 proposalKindHash,
 *          bytes32 proposalGeoHash,
 *          bytes32[] kindProof,
 *          bytes32[] geoProof
 *      )
 *
 *      The pool's mandate roots live in `MandateRegistry`. We pass the
 *      registry address in `terms` so the enforcer is registry-agnostic
 *      at deploy time (different chains may use different registries).
 *
 *      Verification: standard sorted-pair Merkle proof. The leaf is the
 *      already-hashed concept IRI (e.g., `keccak256("trauma-care")` for
 *      kinds, `keccak256("us/colorado")` for geo). Proof bytes are the
 *      sibling hashes from leaf to root. Proof MAY be empty if the leaf
 *      itself IS the root (degenerate single-leaf tree).
 *
 *      Empty kind proof against zero kindsRoot is rejected — that would
 *      otherwise pass any kind through. Same for geo.
 */
contract PoolMandateEnforcer is ICaveatEnforcer {
    error MandateRegistryNotSet();
    error KindNotAccepted();
    error GeoNotAccepted();
    error MandateRootEmpty();

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
        if (registry == address(0) || pool == address(0)) revert MandateRegistryNotSet();

        (
            bytes32 proposalKindHash,
            bytes32 proposalGeoHash,
            bytes32[] memory kindProof,
            bytes32[] memory geoProof
        ) = abi.decode(args, (bytes32, bytes32, bytes32[], bytes32[]));

        bytes32 kindsRoot = MandateRegistry(registry).kindsRoot(pool);
        bytes32 geoRoot   = MandateRegistry(registry).geoRoot(pool);
        if (kindsRoot == bytes32(0) || geoRoot == bytes32(0)) revert MandateRootEmpty();

        if (!_verify(kindProof, kindsRoot, proposalKindHash)) revert KindNotAccepted();
        if (!_verify(geoProof, geoRoot, proposalGeoHash)) revert GeoNotAccepted();
    }

    function afterHook(
        bytes calldata, bytes calldata, bytes32,
        address, address, address, uint256, bytes calldata
    ) external pure override {}

    /// @dev Standard OpenZeppelin-shape sorted-pair Merkle proof verification.
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
