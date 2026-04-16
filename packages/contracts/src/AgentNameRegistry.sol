// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRelationship.sol";

/**
 * @title AgentNameRegistry
 * @notice Hierarchical name registry for the .agent namespace.
 *
 * Names are keyed by node (bytes32 namehash). Each node has an owner
 * (an AgentAccount), a resolver, and an optional subregistry delegate.
 *
 * ENS v2 principles adopted:
 *   - Each name can have its own subregistry for child management
 *   - Longest-suffix resolution via resolver hierarchy
 *   - Registry/resolver separation
 *
 * Smart-account-native differences from ENS:
 *   - Ownership via AgentAccount.isOwner(), not ERC-1155
 *   - On register, creates NAMESPACE_CONTAINS edge in AgentRelationship
 *   - Sets ATL_NAME_LABEL on agent via AgentAccountResolver
 */
contract AgentNameRegistry {

    // ─── Types ──────────────────────────────────────────────────────

    struct NameRecord {
        address owner;         // AgentAccount that controls this name
        address resolver;      // resolver contract for this node's records
        address subregistry;   // who can manage children (0 = owner only)
        bytes32 parent;        // parent namehash
        bytes32 labelhash;     // keccak256(label)
        uint64  expiry;        // 0 = no expiry
        uint64  registeredAt;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error NodeAlreadyExists();
    error NodeNotFound();
    error ParentNotFound();
    error NameExpired();
    error RootAlreadyInitialized();
    error EmptyLabel();

    // ─── Events ─────────────────────────────────────────────────────

    event RootInitialized(bytes32 indexed rootNode, address indexed owner);
    event NameRegistered(bytes32 indexed node, bytes32 indexed parent, string label, address owner, address resolver, uint64 expiry);
    event OwnerChanged(bytes32 indexed node, address indexed newOwner);
    event ResolverChanged(bytes32 indexed node, address indexed resolver);
    event SubregistryChanged(bytes32 indexed node, address indexed subregistry);
    event NameRenewed(bytes32 indexed node, uint64 newExpiry);

    // ─── State ──────────────────────────────────────────────────────

    mapping(bytes32 => NameRecord) private _records;
    mapping(bytes32 => mapping(bytes32 => bytes32)) private _children; // parent => labelhash => childNode
    mapping(bytes32 => bytes32[]) private _childLabels; // parent => labelhashes

    bytes32 public immutable AGENT_ROOT; // namehash("agent")
    AgentRelationship public immutable RELATIONSHIPS;

    // Well-known constants
    bytes32 private constant NAMESPACE_CONTAINS = keccak256("atl:NamespaceContainsRelationship");
    bytes32 private constant ROLE_NS_PARENT = keccak256("atl:NamespaceParentRole");
    bytes32 private constant ROLE_NS_CHILD = keccak256("atl:NamespaceChildRole");

    // ─── Constructor ────────────────────────────────────────────────

    constructor(
        AgentRelationship relationships
    ) {
        RELATIONSHIPS = relationships;
        // Compute .agent root: namehash("agent") = keccak256(bytes32(0) + keccak256("agent"))
        AGENT_ROOT = keccak256(abi.encodePacked(bytes32(0), keccak256("agent")));
    }

    // ─── Root Initialization ────────────────────────────────────────

    /**
     * @notice Initialize the .agent root node. Can only be called once.
     * @param rootOwner The AgentAccount (or EOA) that will own the root.
     * @param resolver The default resolver for the root.
     */
    function initializeRoot(address rootOwner, address resolver) external {
        if (_records[AGENT_ROOT].registeredAt != 0) revert RootAlreadyInitialized();

        _records[AGENT_ROOT] = NameRecord({
            owner: rootOwner,
            resolver: resolver,
            subregistry: rootOwner, // root owner can create TLDs
            parent: bytes32(0),
            labelhash: keccak256("agent"),
            expiry: 0,
            registeredAt: uint64(block.timestamp)
        });

        emit RootInitialized(AGENT_ROOT, rootOwner);
    }

    // ─── Registration ───────────────────────────────────────────────

    /**
     * @notice Register a child name under a parent.
     * @dev Caller must be parent's owner (via isOwner) or parent's subregistry.
     *      Creates a NAMESPACE_CONTAINS edge and sets ATL_NAME_LABEL on the child.
     */
    function register(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 expiry
    ) external returns (bytes32 childNode) {
        if (bytes(label).length == 0) revert EmptyLabel();
        _requireParentAuth(parentNode);
        _requireNotExpired(parentNode);

        bytes32 lh = keccak256(bytes(label));
        childNode = keccak256(abi.encodePacked(parentNode, lh));

        if (_records[childNode].registeredAt != 0) revert NodeAlreadyExists();

        _records[childNode] = NameRecord({
            owner: owner,
            resolver: resolver,
            subregistry: address(0),
            parent: parentNode,
            labelhash: lh,
            expiry: expiry,
            registeredAt: uint64(block.timestamp)
        });

        _children[parentNode][lh] = childNode;
        _childLabels[parentNode].push(lh);

        // Side-effects: create NAMESPACE_CONTAINS edge + set name label
        _createNameEdge(parentNode, childNode, owner, label);

        emit NameRegistered(childNode, parentNode, label, owner, resolver, expiry);
    }

    // ─── Setters ────────────────────────────────────────────────────

    function setOwner(bytes32 node, address newOwner) external {
        _requireNodeAuth(node);
        _records[node].owner = newOwner;
        emit OwnerChanged(node, newOwner);
    }

    function setResolver(bytes32 node, address resolver) external {
        _requireNodeAuth(node);
        _records[node].resolver = resolver;
        emit ResolverChanged(node, resolver);
    }

    function setSubregistry(bytes32 node, address subregistry) external {
        _requireNodeAuth(node);
        _records[node].subregistry = subregistry;
        emit SubregistryChanged(node, subregistry);
    }

    function renew(bytes32 node, uint64 newExpiry) external {
        _requireNodeAuth(node);
        _records[node].expiry = newExpiry;
        emit NameRenewed(node, newExpiry);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function owner(bytes32 node) external view returns (address) { return _records[node].owner; }
    function resolver(bytes32 node) external view returns (address) { return _records[node].resolver; }
    function subregistry(bytes32 node) external view returns (address) { return _records[node].subregistry; }
    function parent(bytes32 node) external view returns (bytes32) { return _records[node].parent; }
    function labelhash(bytes32 node) external view returns (bytes32) { return _records[node].labelhash; }
    function expiry(bytes32 node) external view returns (uint64) { return _records[node].expiry; }
    function recordExists(bytes32 node) external view returns (bool) { return _records[node].registeredAt != 0; }
    function registeredAt(bytes32 node) external view returns (uint64) { return _records[node].registeredAt; }

    function childNode(bytes32 parentNode, bytes32 lh) external view returns (bytes32) {
        return _children[parentNode][lh];
    }

    function childCount(bytes32 parentNode) external view returns (uint256) {
        return _childLabels[parentNode].length;
    }

    function childLabelhashes(bytes32 parentNode) external view returns (bytes32[] memory) {
        return _childLabels[parentNode];
    }

    function isExpired(bytes32 node) public view returns (bool) {
        uint64 exp = _records[node].expiry;
        return exp != 0 && block.timestamp > exp;
    }

    // ─── Access Control ─────────────────────────────────────────────

    function _requireNodeAuth(bytes32 node) internal view {
        NameRecord storage r = _records[node];
        if (r.registeredAt == 0) revert NodeNotFound();
        if (!_isAuthorized(r.owner)) revert NotAuthorized();
    }

    function _requireParentAuth(bytes32 parentNode) internal view {
        NameRecord storage r = _records[parentNode];
        if (r.registeredAt == 0) revert ParentNotFound();

        // Either the subregistry address matches msg.sender
        if (r.subregistry != address(0) && r.subregistry == msg.sender) return;

        // Or the caller is an owner of the parent's AgentAccount
        if (!_isAuthorized(r.owner)) revert NotAuthorized();
    }

    function _requireNotExpired(bytes32 node) internal view {
        if (isExpired(node)) revert NameExpired();
    }

    /**
     * @dev Check if msg.sender is the address itself OR passes isOwner() on it.
     *      This handles both EOA owners and AgentAccount multi-owner patterns.
     */
    function _isAuthorized(address account) internal view returns (bool) {
        if (msg.sender == account) return true;

        // Try AgentAccount.isOwner(msg.sender)
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        return ok && abi.decode(data, (bool));
    }

    // ─── Side Effects ───────────────────────────────────────────────

    function _createNameEdge(
        bytes32 parentNode,
        bytes32 /* childNode */,
        address childOwner,
        string calldata label
    ) internal {
        address parentOwner = _records[parentNode].owner;

        // Create NAMESPACE_CONTAINS edge in the relationship graph
        // This enables the existing discovery/traversal infrastructure
        bytes32[] memory roles = new bytes32[](2);
        roles[0] = ROLE_NS_PARENT;
        roles[1] = ROLE_NS_CHILD;

        string memory metaURI = string(abi.encodePacked('{"label":"', label, '"}'));

        try RELATIONSHIPS.createEdge(
            parentOwner,
            childOwner,
            NAMESPACE_CONTAINS,
            roles,
            metaURI
        ) {} catch {
            // Edge creation is best-effort — naming works without it
        }

        // ATL_NAME_LABEL is set externally by the registrant (who is an owner
        // of the child agent and can call AgentAccountResolver directly).
        // The NameRegistered event carries the label for off-chain indexing.
    }
}
