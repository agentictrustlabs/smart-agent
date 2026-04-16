// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";
import "./AgentNameResolver.sol";
import "./AgentAccountResolver.sol";
import "./AgentPredicates.sol";

/**
 * @title AgentNameUniversalResolver
 * @notice Read-only facade for resolving .agent names end-to-end.
 *
 * Implements longest-suffix resolution: walks the name hierarchy from root,
 * finds the resolver responsible for the name, and returns the resolved address
 * and records.
 *
 * Combines name-first resolution (this contract) with agent-profile resolution
 * (existing AgentUniversalResolver) to provide a complete picture.
 */
contract AgentNameUniversalResolver {

    // ─── Errors ─────────────────────────────────────────────────────

    error NameNotFound();
    error ResolverNotSet();

    // ─── State ──────────────────────────────────────────────────────

    AgentNameRegistry public immutable REGISTRY;
    AgentNameResolver public immutable NAME_RESOLVER;
    AgentAccountResolver public immutable ACCOUNT_RESOLVER;

    constructor(
        AgentNameRegistry registry,
        AgentNameResolver nameResolver,
        AgentAccountResolver accountResolver
    ) {
        REGISTRY = registry;
        NAME_RESOLVER = nameResolver;
        ACCOUNT_RESOLVER = accountResolver;
    }

    // ─── Resolution ─────────────────────────────────────────────────

    /**
     * @notice Resolve a node to its address.
     * @param node The namehash of the name to resolve.
     * @return The resolved ETH address.
     */
    function resolveNode(bytes32 node) external view returns (address) {
        if (!REGISTRY.recordExists(node)) revert NameNotFound();

        // Check if the node has a specific resolver
        address resolverAddr = REGISTRY.resolver(node);
        if (resolverAddr != address(0)) {
            // Try to read addr from the resolver
            try AgentNameResolver(resolverAddr).addr(node) returns (address resolved) {
                if (resolved != address(0)) return resolved;
            } catch {}
        }

        // Fallback: the node owner IS the resolved address
        return REGISTRY.owner(node);
    }

    /**
     * @notice Resolve a node's text record.
     */
    function resolveText(bytes32 node, string calldata key) external view returns (string memory) {
        address resolverAddr = _findResolver(node);
        if (resolverAddr == address(0)) revert ResolverNotSet();
        return AgentNameResolver(resolverAddr).text(node, key);
    }

    /**
     * @notice Find the resolver responsible for a node (longest-suffix).
     * @dev Walks from the node up to root, returning the first resolver found.
     */
    function findResolver(bytes32 node) external view returns (address resolverAddr, bytes32 resolvedNode) {
        return _findResolverWithNode(node);
    }

    /**
     * @notice Reverse resolve: address → primary name.
     * @dev Reads ATL_PRIMARY_NAME from AgentAccountResolver.
     */
    function reverseResolve(address account) external view returns (string memory) {
        try ACCOUNT_RESOLVER.getStringProperty(account, AgentPredicates.ATL_PRIMARY_NAME)
            returns (string memory name)
        {
            return name;
        } catch {
            return "";
        }
    }

    /**
     * @notice Check if a reverse resolution round-trips correctly.
     * @dev resolve(primaryName(addr)) == addr
     */
    function verifyRoundTrip(address account, bytes32 claimedNode) external view returns (bool) {
        // Get the primary name's node
        if (!REGISTRY.recordExists(claimedNode)) return false;

        // Resolve the node to an address
        address resolved = REGISTRY.owner(claimedNode);

        // Check resolver addr record if available
        address resolverAddr = REGISTRY.resolver(claimedNode);
        if (resolverAddr != address(0)) {
            try AgentNameResolver(resolverAddr).addr(claimedNode) returns (address addrResult) {
                if (addrResult != address(0)) resolved = addrResult;
            } catch {}
        }

        return resolved == account;
    }

    /**
     * @notice Get all children of a node with their resolved addresses.
     */
    function getChildren(bytes32 parentNode) external view returns (
        bytes32[] memory childNodes,
        address[] memory owners
    ) {
        bytes32[] memory labelhashes = REGISTRY.childLabelhashes(parentNode);
        childNodes = new bytes32[](labelhashes.length);
        owners = new address[](labelhashes.length);

        for (uint256 i = 0; i < labelhashes.length; i++) {
            bytes32 child = REGISTRY.childNode(parentNode, labelhashes[i]);
            childNodes[i] = child;
            owners[i] = REGISTRY.owner(child);
        }
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _findResolver(bytes32 node) internal view returns (address) {
        (address resolverAddr,) = _findResolverWithNode(node);
        return resolverAddr;
    }

    /**
     * @dev Longest-suffix resolution: walk from node to root,
     *      return the first node that has a resolver set.
     */
    function _findResolverWithNode(bytes32 node) internal view returns (address, bytes32) {
        bytes32 current = node;
        for (uint8 depth = 0; depth < 10; depth++) {
            if (!REGISTRY.recordExists(current)) break;

            address resolverAddr = REGISTRY.resolver(current);
            if (resolverAddr != address(0)) {
                return (resolverAddr, current);
            }

            bytes32 parentNode = REGISTRY.parent(current);
            if (parentNode == bytes32(0)) break;
            current = parentNode;
        }
        return (address(0), bytes32(0));
    }
}
