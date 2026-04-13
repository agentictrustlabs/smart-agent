// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RelationshipTypeRegistry
 * @notice Governed registry of relationship type semantic metadata.
 *
 * Each relationship type declared in AgentRelationship can be annotated here
 * with semantic properties that control how the graph should be interpreted:
 *
 * - isHierarchical: the type forms parent→child trees (source=superordinate, target=subordinate)
 * - isTransitive: the type supports ancestor/descendant traversal
 * - isSymmetric: source↔target are interchangeable
 *
 * Governance: only the governor address can register or update types.
 * Same pattern as OntologyTermRegistry.
 */
contract RelationshipTypeRegistry {
    struct TypeSemantics {
        bytes32 relationshipType;    // keccak256 key (e.g., keccak256("HasMember"))
        string label;                // human-readable label
        bool isHierarchical;         // forms parent-child trees
        bool isTransitive;           // supports transitive closure
        bool isSymmetric;            // source↔target interchangeable
        bool active;
        uint256 registeredAt;
    }

    address public governor;
    mapping(bytes32 => TypeSemantics) private _types;
    bytes32[] private _typeIds;

    event TypeRegistered(bytes32 indexed relationshipType, string label, bool isHierarchical, bool isTransitive, bool isSymmetric);
    event TypeDeactivated(bytes32 indexed relationshipType);
    event TypeActivated(bytes32 indexed relationshipType);
    event TypeUpdated(bytes32 indexed relationshipType, bool isHierarchical, bool isTransitive, bool isSymmetric);
    event GovernorTransferred(address indexed oldGovernor, address indexed newGovernor);

    error NotGovernor();
    error TypeExists();
    error TypeNotFound();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_) {
        governor = governor_;
    }

    function transferGovernor(address newGovernor) external onlyGovernor {
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    // ─── Registration ───────────────────────────────────────────────

    function registerType(
        bytes32 relationshipType,
        string calldata label,
        bool hierarchical,
        bool transitive,
        bool symmetric
    ) external onlyGovernor {
        if (_types[relationshipType].registeredAt != 0) revert TypeExists();

        _types[relationshipType] = TypeSemantics({
            relationshipType: relationshipType,
            label: label,
            isHierarchical: hierarchical,
            isTransitive: transitive,
            isSymmetric: symmetric,
            active: true,
            registeredAt: block.timestamp
        });
        _typeIds.push(relationshipType);

        emit TypeRegistered(relationshipType, label, hierarchical, transitive, symmetric);
    }

    function updateSemantics(
        bytes32 relationshipType,
        bool hierarchical,
        bool transitive,
        bool symmetric
    ) external onlyGovernor {
        if (_types[relationshipType].registeredAt == 0) revert TypeNotFound();

        _types[relationshipType].isHierarchical = hierarchical;
        _types[relationshipType].isTransitive = transitive;
        _types[relationshipType].isSymmetric = symmetric;

        emit TypeUpdated(relationshipType, hierarchical, transitive, symmetric);
    }

    function deactivateType(bytes32 relationshipType) external onlyGovernor {
        if (_types[relationshipType].registeredAt == 0) revert TypeNotFound();
        _types[relationshipType].active = false;
        emit TypeDeactivated(relationshipType);
    }

    function activateType(bytes32 relationshipType) external onlyGovernor {
        if (_types[relationshipType].registeredAt == 0) revert TypeNotFound();
        _types[relationshipType].active = true;
        emit TypeActivated(relationshipType);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getTypeSemantics(bytes32 relationshipType) external view returns (TypeSemantics memory) {
        return _types[relationshipType];
    }

    function isRegistered(bytes32 relationshipType) external view returns (bool) {
        return _types[relationshipType].registeredAt != 0;
    }

    function isHierarchical(bytes32 relationshipType) external view returns (bool) {
        return _types[relationshipType].isHierarchical;
    }

    function isTransitive(bytes32 relationshipType) external view returns (bool) {
        return _types[relationshipType].isTransitive;
    }

    function isSymmetric(bytes32 relationshipType) external view returns (bool) {
        return _types[relationshipType].isSymmetric;
    }

    function typeCount() external view returns (uint256) {
        return _typeIds.length;
    }

    function getTypeAt(uint256 index) external view returns (bytes32) {
        return _typeIds[index];
    }
}
