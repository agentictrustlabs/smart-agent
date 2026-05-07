// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";
import "./OntologyTermRegistry.sol";
import "./OntologyAttributeStore.sol";

/**
 * @title AgentNameAttributeResolver
 * @notice Per-node resolver for the .agent namespace. Phase 0.2: typed text
 *         records route through OntologyAttributeStore; ENSIP-9 multi-coin
 *         address records stay on-contract because they don't fit the
 *         attribute-store model cleanly.
 *
 * Subject id for a name node is the node itself (already a bytes32 namehash).
 * The resolver is registered as a trustedWriter on AttributeAuth so
 * authorized writes pass through to the store.
 *
 * Compatibility: the legacy text(node, key) ABI is preserved. The key is
 * hashed to a predicate id; unregistered keys soft-fail to "" (mirrors ENS
 * "no record set" semantics).
 */
contract AgentNameAttributeResolver {
    AgentNameRegistry public immutable REGISTRY;
    OntologyTermRegistry public immutable ONTOLOGY;
    OntologyAttributeStore public immutable STORE;

    error NotAuthorized();
    error NodeNotFound();
    error PredicateNotRegistered();

    event AddrChanged(bytes32 indexed node, uint256 coinType, address addr);
    event AliasSet(bytes32 indexed node, bytes32 targetNode);
    event RecordsCleared(bytes32 indexed node, uint64 newVersion);
    event OperatorSet(bytes32 indexed node, address indexed operator, bool approved);
    event AttributeRouted(bytes32 indexed node, bytes32 indexed predicate);

    // Address records — multi-coin per ENSIP-9; on-contract.
    mapping(bytes32 => mapping(uint256 => address)) private _addresses;
    mapping(bytes32 => bytes32) private _aliases;
    mapping(bytes32 => uint64) private _versions;
    mapping(bytes32 => mapping(address => bool)) private _operators;

    constructor(AgentNameRegistry registry, address ontologyRegistry, address attributeStore) {
        REGISTRY = registry;
        ONTOLOGY = OntologyTermRegistry(ontologyRegistry);
        STORE = OntologyAttributeStore(attributeStore);
    }

    // ─── Address records (ENSIP-9) ──────────────────────────────────

    function setAddr(bytes32 node, address addr_) external {
        _requireAuth(node);
        _addresses[node][60] = addr_;
        emit AddrChanged(node, 60, addr_);
    }

    function setAddrForCoin(bytes32 node, uint256 coinType, address addr_) external {
        _requireAuth(node);
        _addresses[node][coinType] = addr_;
        emit AddrChanged(node, coinType, addr_);
    }

    function addr(bytes32 node) external view returns (address) {
        return _addresses[_resolveAlias(node)][60];
    }

    function addrForCoin(bytes32 node, uint256 coinType) external view returns (address) {
        return _addresses[_resolveAlias(node)][coinType];
    }

    // ─── Typed attribute setters ────────────────────────────────────

    function setStringAttribute(bytes32 node, bytes32 predicate, string calldata value) external {
        _requireAuth(node);
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotRegistered();
        STORE.setString(node, predicate, value);
        emit AttributeRouted(node, predicate);
    }

    function setAddressAttribute(bytes32 node, bytes32 predicate, address value) external {
        _requireAuth(node);
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotRegistered();
        STORE.setAddress(node, predicate, value);
        emit AttributeRouted(node, predicate);
    }

    function setBoolAttribute(bytes32 node, bytes32 predicate, bool value) external {
        _requireAuth(node);
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotRegistered();
        STORE.setBool(node, predicate, value);
        emit AttributeRouted(node, predicate);
    }

    function setUintAttribute(bytes32 node, bytes32 predicate, uint256 value) external {
        _requireAuth(node);
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotRegistered();
        STORE.setUint(node, predicate, value);
        emit AttributeRouted(node, predicate);
    }

    function setBytes32Attribute(bytes32 node, bytes32 predicate, bytes32 value) external {
        _requireAuth(node);
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotRegistered();
        STORE.setBytes32(node, predicate, value);
        emit AttributeRouted(node, predicate);
    }

    // ─── Typed attribute getters (read-side; alias resolution applied) ─

    function getStringAttribute(bytes32 node, bytes32 predicate) external view returns (string memory) {
        return STORE.getString(_resolveAlias(node), predicate);
    }

    function getAddressAttribute(bytes32 node, bytes32 predicate) external view returns (address) {
        return STORE.getAddress(_resolveAlias(node), predicate);
    }

    function getBoolAttribute(bytes32 node, bytes32 predicate) external view returns (bool) {
        return STORE.getBool(_resolveAlias(node), predicate);
    }

    function getUintAttribute(bytes32 node, bytes32 predicate) external view returns (uint256) {
        return STORE.getUint(_resolveAlias(node), predicate);
    }

    function getBytes32Attribute(bytes32 node, bytes32 predicate) external view returns (bytes32) {
        return STORE.getBytes32(_resolveAlias(node), predicate);
    }

    // ─── ENS-style text() compatibility shim ─────────────────────────

    /// @notice ENS-style text record lookup. Hashes the key to a predicate
    ///         id and reads from the attribute store; returns "" if the
    ///         predicate is not registered (mirrors ENS no-record-set).
    function text(bytes32 node, string calldata key) external view returns (string memory) {
        bytes32 predicate = keccak256(bytes(key));
        if (!ONTOLOGY.isActive(predicate)) return "";
        return STORE.getString(_resolveAlias(node), predicate);
    }

    // ─── Aliases / versioning / operators ───────────────────────────

    function setAlias(bytes32 node, bytes32 targetNode) external {
        _requireAuth(node);
        _aliases[node] = targetNode;
        emit AliasSet(node, targetNode);
    }

    function aliasOf(bytes32 node) external view returns (bytes32) {
        return _aliases[node];
    }

    function clearRecords(bytes32 node) external {
        _requireAuth(node);
        _versions[node]++;
        emit RecordsCleared(node, _versions[node]);
    }

    function version(bytes32 node) external view returns (uint64) {
        return _versions[node];
    }

    function setOperator(bytes32 node, address operator, bool approved) external {
        _requireOwnerOnly(node);
        _operators[node][operator] = approved;
        emit OperatorSet(node, operator, approved);
    }

    function isOperator(bytes32 node, address operator) external view returns (bool) {
        return _operators[node][operator];
    }

    // ─── Auth ───────────────────────────────────────────────────────

    function _requireAuth(bytes32 node) internal view {
        if (!REGISTRY.recordExists(node)) revert NodeNotFound();
        address nodeOwner = REGISTRY.owner(node);

        if (msg.sender == nodeOwner) return;

        if (nodeOwner.code.length > 0) {
            (bool ok, bytes memory data) = nodeOwner.staticcall(
                abi.encodeWithSignature("isOwner(address)", msg.sender)
            );
            if (ok && data.length >= 32 && abi.decode(data, (bool))) return;
        }

        if (_operators[node][msg.sender]) return;

        revert NotAuthorized();
    }

    function _requireOwnerOnly(bytes32 node) internal view {
        if (!REGISTRY.recordExists(node)) revert NodeNotFound();
        address nodeOwner = REGISTRY.owner(node);

        if (msg.sender == nodeOwner) return;

        if (nodeOwner.code.length > 0) {
            (bool ok, bytes memory data) = nodeOwner.staticcall(
                abi.encodeWithSignature("isOwner(address)", msg.sender)
            );
            if (ok && data.length >= 32 && abi.decode(data, (bool))) return;
        }

        revert NotAuthorized();
    }

    function _resolveAlias(bytes32 node) internal view returns (bytes32) {
        bytes32 current = node;
        for (uint8 i = 0; i < 3; i++) {
            bytes32 target = _aliases[current];
            if (target == bytes32(0)) return current;
            current = target;
        }
        return current;
    }
}
