// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRelationship.sol";
import "./RelationshipTypeRegistry.sol";

/**
 * @title AgentRelationshipQuery
 * @notice Read-only view contract for directed relationship traversal.
 *
 * Provides graph-query methods on top of the AgentRelationship edge store:
 * - directTargetsOf: all agents that `agent` points TO via a given relationship type
 * - directSourcesOf: all agents that point TO `agent` via a given relationship type
 *
 * Recursive traversal (descendantsOf, ancestorsOf, commonAncestorsOf) is
 * performed off-chain in the SDK to avoid unbounded gas costs.
 *
 * Ontology alignment:
 * - directTargetsOf returns subordinates / targets / children depending on the type's semantics
 * - directSourcesOf returns superordinates / sources / parents
 */
contract AgentRelationshipQuery {
    AgentRelationship public immutable RELATIONSHIPS;
    RelationshipTypeRegistry public immutable TYPE_REGISTRY;

    constructor(address relationships, address typeRegistry) {
        RELATIONSHIPS = AgentRelationship(relationships);
        TYPE_REGISTRY = RelationshipTypeRegistry(typeRegistry);
    }

    /**
     * @notice Get all agents that `agent` points TO via `relationType`.
     *         Filters to ACTIVE edges only. Returns unique addresses.
     * @param agent The source agent address
     * @param relationType The relationship type to filter by (bytes32(0) for all types)
     */
    function directTargetsOf(address agent, bytes32 relationType) external view returns (address[] memory) {
        bytes32[] memory edgeIds = RELATIONSHIPS.getEdgesBySubject(agent);
        address[] memory temp = new address[](edgeIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < edgeIds.length; i++) {
            AgentRelationship.Edge memory edge = RELATIONSHIPS.getEdge(edgeIds[i]);
            if (edge.status != AgentRelationship.EdgeStatus.ACTIVE &&
                edge.status != AgentRelationship.EdgeStatus.CONFIRMED) continue;
            if (relationType != bytes32(0) && edge.relationshipType != relationType) continue;
            // Deduplicate
            bool dup = false;
            for (uint256 j = 0; j < count; j++) {
                if (temp[j] == edge.object_) { dup = true; break; }
            }
            if (!dup) { temp[count] = edge.object_; count++; }
        }

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) result[i] = temp[i];
        return result;
    }

    /**
     * @notice Get all agents that point TO `agent` via `relationType`.
     *         Filters to ACTIVE edges only. Returns unique addresses.
     * @param agent The target agent address
     * @param relationType The relationship type to filter by (bytes32(0) for all types)
     */
    function directSourcesOf(address agent, bytes32 relationType) external view returns (address[] memory) {
        bytes32[] memory edgeIds = RELATIONSHIPS.getEdgesByObject(agent);
        address[] memory temp = new address[](edgeIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < edgeIds.length; i++) {
            AgentRelationship.Edge memory edge = RELATIONSHIPS.getEdge(edgeIds[i]);
            if (edge.status != AgentRelationship.EdgeStatus.ACTIVE &&
                edge.status != AgentRelationship.EdgeStatus.CONFIRMED) continue;
            if (relationType != bytes32(0) && edge.relationshipType != relationType) continue;
            bool dup = false;
            for (uint256 j = 0; j < count; j++) {
                if (temp[j] == edge.subject) { dup = true; break; }
            }
            if (!dup) { temp[count] = edge.subject; count++; }
        }

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) result[i] = temp[i];
        return result;
    }

    /**
     * @notice Check if `relationType` is registered as hierarchical in the type registry.
     */
    function isHierarchicalType(bytes32 relationType) external view returns (bool) {
        return TYPE_REGISTRY.isHierarchical(relationType);
    }

    /**
     * @notice Check if `relationType` is registered as transitive in the type registry.
     */
    function isTransitiveType(bytes32 relationType) external view returns (bool) {
        return TYPE_REGISTRY.isTransitive(relationType);
    }
}
