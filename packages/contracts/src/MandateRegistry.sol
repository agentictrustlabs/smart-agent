// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MandateRegistry
 * @notice Per-pool mandate Merkle roots — the public source of truth for
 *         which kinds / geographies a Pool's stewards may direct funds to.
 *
 * @dev `kindsRoot` is a Merkle root computed off-chain over the canonical
 *      hashed C-Box concept IRIs (e.g., keccak256("trauma-care"),
 *      keccak256("HeartLanguageScripture")). `geoRoot` is a Merkle root over
 *      hashed `.geo` IRIs (e.g., keccak256("us/colorado")).
 *
 *      `PoolMandateEnforcer` reads from this registry at delegation-redeem
 *      time so updating a mandate is a single registry write rather than
 *      a re-mint of the entire delegation chain.
 *
 *      Auth: only the Pool itself (msg.sender == pool address) can update its
 *      mandate. The Pool's stewards exercise this via `pool:update_mandate`
 *      MCP tool which redeems a STEWARDSHIP_DELEGATION ⟶ pool.execute ⟶
 *      MandateRegistry.setMandate.
 *
 *      Mirror class assertion: `sa:PoolMandateUpdatedAssertion` (emitted
 *      separately by the action layer; this contract's events feed the
 *      on-chain → GraphDB sync as a coarse fallback).
 */
contract MandateRegistry {
    error NotPool();

    mapping(address => bytes32) public kindsRoot;
    mapping(address => bytes32) public geoRoot;

    event MandateUpdated(address indexed pool, bytes32 kindsRoot, bytes32 geoRoot);

    /**
     * @notice Replace a pool's mandate roots. Restricted to the pool itself
     *         so only a steward-redeemed delegation can mutate.
     * @param pool   Pool address (the pool's AgentAccount).
     * @param kindsRoot_ New Merkle root over allowed kind IRI hashes.
     * @param geoRoot_   New Merkle root over allowed geo IRI hashes.
     */
    function setMandate(address pool, bytes32 kindsRoot_, bytes32 geoRoot_) external {
        if (msg.sender != pool) revert NotPool();
        kindsRoot[pool] = kindsRoot_;
        geoRoot[pool] = geoRoot_;
        emit MandateUpdated(pool, kindsRoot_, geoRoot_);
    }
}
