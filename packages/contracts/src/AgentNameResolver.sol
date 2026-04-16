// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";

/**
 * @title AgentNameResolver
 * @notice Per-node resolver for the .agent namespace.
 *
 * Stores records keyed by node (bytes32 namehash): addresses, text records,
 * aliases, and versioning. Supports operator permissions for delegated
 * record management.
 *
 * This is the "PermissionedAgentResolver" — extends the resolver concept
 * to support per-node records with fine-grained access control.
 */
contract AgentNameResolver {

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error NodeNotFound();
    error AliasLoop();

    // ─── Events ─────────────────────────────────────────────────────

    event AddrChanged(bytes32 indexed node, uint256 coinType, address addr);
    event TextChanged(bytes32 indexed node, string key, string value);
    event AliasSet(bytes32 indexed node, bytes32 targetNode);
    event RecordsCleared(bytes32 indexed node, uint64 newVersion);
    event OperatorSet(bytes32 indexed node, address indexed operator, bool approved);

    // ─── State ──────────────────────────────────────────────────────

    // Address records: node => coinType => address
    // coinType 60 = ETH (default), follows ENSIP-9 for multichain
    mapping(bytes32 => mapping(uint256 => address)) private _addresses;

    // Text records: node => key => value
    mapping(bytes32 => mapping(string => string)) private _texts;

    // Record versioning: node => version (bumped on clearRecords)
    mapping(bytes32 => uint64) private _versions;

    // Aliases: node => target node (CNAME-like redirect)
    mapping(bytes32 => bytes32) private _aliases;

    // Operator permissions: node => operator => approved
    mapping(bytes32 => mapping(address => bool)) private _operators;

    AgentNameRegistry public immutable REGISTRY;

    // ─── Constructor ────────────────────────────────────────────────

    constructor(AgentNameRegistry registry) {
        REGISTRY = registry;
    }

    // ─── Address Records ────────────────────────────────────────────

    /**
     * @notice Set the ETH address for a node (coinType 60).
     */
    function setAddr(bytes32 node, address addr_) external {
        _requireAuth(node);
        _addresses[node][60] = addr_;
        emit AddrChanged(node, 60, addr_);
    }

    /**
     * @notice Set a multichain address for a node (ENSIP-9).
     */
    function setAddrForCoin(bytes32 node, uint256 coinType, address addr_) external {
        _requireAuth(node);
        _addresses[node][coinType] = addr_;
        emit AddrChanged(node, coinType, addr_);
    }

    /**
     * @notice Get the ETH address for a node, following aliases.
     */
    function addr(bytes32 node) external view returns (address) {
        bytes32 resolved = _resolveAlias(node);
        return _addresses[resolved][60];
    }

    /**
     * @notice Get a multichain address for a node.
     */
    function addrForCoin(bytes32 node, uint256 coinType) external view returns (address) {
        bytes32 resolved = _resolveAlias(node);
        return _addresses[resolved][coinType];
    }

    // ─── Text Records ───────────────────────────────────────────────

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _requireAuth(node);
        _texts[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        bytes32 resolved = _resolveAlias(node);
        return _texts[resolved][key];
    }

    // ─── Aliases ────────────────────────────────────────────────────

    /**
     * @notice Set an alias — this node's records redirect to targetNode.
     */
    function setAlias(bytes32 node, bytes32 targetNode) external {
        _requireAuth(node);
        _aliases[node] = targetNode;
        emit AliasSet(node, targetNode);
    }

    function aliasOf(bytes32 node) external view returns (bytes32) {
        return _aliases[node];
    }

    // ─── Versioning ─────────────────────────────────────────────────

    /**
     * @notice Clear all records for a node by bumping the version.
     * @dev Does not delete storage — just increments version counter.
     *      Clients should check version for cache invalidation.
     */
    function clearRecords(bytes32 node) external {
        _requireAuth(node);
        _versions[node]++;
        emit RecordsCleared(node, _versions[node]);
    }

    function version(bytes32 node) external view returns (uint64) {
        return _versions[node];
    }

    // ─── Operators ──────────────────────────────────────────────────

    /**
     * @notice Approve or revoke an operator for a node.
     * @dev Only the node owner can set operators (not operators themselves).
     */
    function setOperator(bytes32 node, address operator, bool approved) external {
        _requireOwnerOnly(node);
        _operators[node][operator] = approved;
        emit OperatorSet(node, operator, approved);
    }

    function isOperator(bytes32 node, address operator) external view returns (bool) {
        return _operators[node][operator];
    }

    // ─── Access Control ─────────────────────────────────────────────

    /**
     * @dev Node owner OR approved operator can set records.
     */
    function _requireAuth(bytes32 node) internal view {
        if (!REGISTRY.recordExists(node)) revert NodeNotFound();
        address nodeOwner = REGISTRY.owner(node);

        // Direct owner
        if (msg.sender == nodeOwner) return;

        // AgentAccount owner
        (bool ok, bytes memory data) = nodeOwner.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        if (ok && abi.decode(data, (bool))) return;

        // Approved operator
        if (_operators[node][msg.sender]) return;

        revert NotAuthorized();
    }

    /**
     * @dev Only the node owner (not operators) for privileged operations.
     */
    function _requireOwnerOnly(bytes32 node) internal view {
        if (!REGISTRY.recordExists(node)) revert NodeNotFound();
        address nodeOwner = REGISTRY.owner(node);

        if (msg.sender == nodeOwner) return;

        (bool ok, bytes memory data) = nodeOwner.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        if (!ok || !abi.decode(data, (bool))) revert NotAuthorized();
    }

    /**
     * @dev Follow alias chain (max 3 hops to prevent loops).
     */
    function _resolveAlias(bytes32 node) internal view returns (bytes32) {
        bytes32 current = node;
        for (uint8 i = 0; i < 3; i++) {
            bytes32 target = _aliases[current];
            if (target == bytes32(0)) return current;
            current = target;
        }
        return current; // stop after 3 hops
    }
}
