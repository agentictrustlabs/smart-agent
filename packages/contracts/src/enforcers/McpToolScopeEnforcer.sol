// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title McpToolScopeEnforcer
 * @notice On-chain no-op marker enforcer for MCP tool-scope caveats.
 *
 * MCP tool-scope ("which MCP tools may this session call") is enforced
 * OFF-CHAIN by each MCP server's `verify-delegation.ts` — it decodes the
 * caveat's terms (an ABI-encoded `string[] allowedTools`) and rejects
 * calls whose tool name is not in the list.
 *
 * Pre-Phase-1 the same delegation was never redeemed on-chain, so the
 * on-chain "enforcer" didn't need to exist — the codebase used a sentinel
 * hash address. Phase 1 unified the auth path: the SAME delegation now
 * ALSO gets redeemed via DelegationManager.redeemDelegation, which calls
 * `beforeHook` on every caveat's enforcer. Calling a non-contract address
 * reverts the whole redeem.
 *
 * This contract is the real on-chain landing pad: `beforeHook` is a no-op
 * (sanity-checks terms shape). The real policy stays off-chain.
 */
contract McpToolScopeEnforcer is ICaveatEnforcer {
    error InvalidMcpToolScopeTerms();

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
        // Validate shape only; real policy is off-chain in the MCP verifier.
        if (terms.length < 64) revert InvalidMcpToolScopeTerms();
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
        // No post-execution check.
    }
}
