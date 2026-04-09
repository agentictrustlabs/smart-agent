// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRelationship.sol";
import "./AgentAssertion.sol";

/**
 * @title AgentRelationshipResolver
 * @notice Qualification and policy layer for relationship edges.
 *
 * Now works with multi-role edges: one edge per (subject, object, relationshipType),
 * with a set of roles on each edge.
 */
contract AgentRelationshipResolver {
    AgentRelationship public immutable RELATIONSHIP;
    AgentAssertion public immutable ASSERTION;

    enum ResolutionMode {
        EDGE_ACTIVE_ONLY,
        REQUIRE_ANY_VALID_ASSERTION,
        REQUIRE_OBJECT_ASSERTION,
        REQUIRE_MUTUAL_ASSERTION,
        REQUIRE_VALIDATOR_ASSERTION
    }

    constructor(address relationshipAddress, address assertionAddress) {
        RELATIONSHIP = AgentRelationship(relationshipAddress);
        ASSERTION = AgentAssertion(assertionAddress);
    }

    /**
     * @notice Check if an edge is protocol-usable under the given resolution mode.
     */
    function isRelationshipActive(
        bytes32 edgeId,
        ResolutionMode mode
    ) public view returns (bool) {
        AgentRelationship.Edge memory e = RELATIONSHIP.getEdge(edgeId);

        if (e.status != AgentRelationship.EdgeStatus.ACTIVE) {
            return false;
        }

        if (mode == ResolutionMode.EDGE_ACTIVE_ONLY) {
            return true;
        }

        uint256[] memory ids = ASSERTION.getAssertionsByEdge(edgeId);

        bool hasAny;
        bool hasObject;
        bool hasSubject;

        for (uint256 i = 0; i < ids.length; i++) {
            if (!ASSERTION.isAssertionCurrentlyValid(ids[i])) continue;

            AgentAssertion.AssertionRecord memory a = ASSERTION.getAssertion(ids[i]);
            hasAny = true;

            if (a.asserter == e.object_) hasObject = true;
            if (a.asserter == e.subject) hasSubject = true;

            if (mode == ResolutionMode.REQUIRE_ANY_VALID_ASSERTION && hasAny) return true;
            if (mode == ResolutionMode.REQUIRE_OBJECT_ASSERTION && hasObject) return true;
        }

        if (mode == ResolutionMode.REQUIRE_MUTUAL_ASSERTION) {
            return hasObject && hasSubject;
        }

        return false;
    }

    /**
     * @notice Check if subject holds a specific role relative to object.
     *         Edge must exist, be active (per mode), and contain the role.
     */
    function holdsRole(
        address subject,
        address object_,
        bytes32 role,
        bytes32 relationshipType,
        ResolutionMode mode
    ) external view returns (bool) {
        bytes32 edgeId = RELATIONSHIP.computeEdgeId(subject, object_, relationshipType);

        if (!RELATIONSHIP.edgeExists(edgeId)) return false;
        if (!RELATIONSHIP.hasRole(edgeId, role)) return false;
        if (!isRelationshipActive(edgeId, mode)) return false;

        return true;
    }

    /**
     * @notice Get all roles on an active edge for a subject-object-relationshipType triple.
     *         Returns empty if edge doesn't exist or isn't active.
     */
    function getActiveRoles(
        address subject,
        address object_,
        bytes32 relationshipType,
        ResolutionMode mode
    ) external view returns (bytes32[] memory) {
        bytes32 edgeId = RELATIONSHIP.computeEdgeId(subject, object_, relationshipType);

        if (!RELATIONSHIP.edgeExists(edgeId)) return new bytes32[](0);
        if (!isRelationshipActive(edgeId, mode)) return new bytes32[](0);

        return RELATIONSHIP.getRoles(edgeId);
    }
}
