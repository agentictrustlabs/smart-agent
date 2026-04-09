// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRelationship.sol";
import "./AgentReviewRecord.sol";
import "./AgentDisputeRecord.sol";

/**
 * @title AgentTrustProfile
 * @notice Context-specific trust resolution profiles.
 *
 * Answers: "What facts count toward trust in a given context?"
 *
 * Profiles:
 * - Discovery Trust: does the agent have org control + validation + reviews?
 * - Execution Trust: does the agent have delegation authority + TEE + no open disputes?
 * - Governance Trust: does the org have identified leadership + compliance?
 * - Insurance Trust: does the agent have active insurance coverage?
 * - Economic Trust: is the agent backed by staking/bonding?
 * - Runtime Trust: does the agent have TEE attestation + build provenance?
 */
contract AgentTrustProfile {
    AgentRelationship public immutable RELATIONSHIP;
    AgentReviewRecord public immutable REVIEWS;
    AgentDisputeRecord public immutable DISPUTES;

    constructor(address relationship, address reviews, address disputes) {
        RELATIONSHIP = AgentRelationship(relationship);
        REVIEWS = AgentReviewRecord(reviews);
        DISPUTES = AgentDisputeRecord(disputes);
    }

    struct TrustResult {
        bool passes;
        uint256 score;           // 0-100
        uint256 edgeCount;
        uint256 reviewCount;
        uint256 avgReviewScore;
        uint256 openDisputes;
    }

    /**
     * @notice Check discovery trust: org control + reviews + no disputes
     */
    function checkDiscoveryTrust(address agent) external view returns (TrustResult memory result) {
        // Check org control edges
        bytes32[] memory edges = RELATIONSHIP.getEdgesBySubject(agent);
        uint256 controlEdges = 0;
        for (uint256 i = 0; i < edges.length; i++) {
            if (RELATIONSHIP.edgeExists(edges[i])) {
                AgentRelationship.Edge memory e = RELATIONSHIP.getEdge(edges[i]);
                if (e.status == AgentRelationship.EdgeStatus.ACTIVE) controlEdges++;
            }
        }
        result.edgeCount = controlEdges;

        // Check reviews
        (uint256 avg, uint256 count) = REVIEWS.getAverageScore(agent);
        result.reviewCount = count;
        result.avgReviewScore = avg;

        // Check disputes
        result.openDisputes = DISPUTES.getOpenDisputeCount(agent);

        // Score
        uint256 score = 0;
        if (controlEdges > 0) score += 30;
        if (count >= 2) score += 20;
        if (avg >= 60) score += 30;
        if (result.openDisputes == 0) score += 20;
        result.score = score;
        result.passes = score >= 50;
    }

    /**
     * @notice Check execution trust: delegation + TEE + no disputes
     */
    function checkExecutionTrust(address agent) external view returns (TrustResult memory result) {
        bytes32[] memory edges = RELATIONSHIP.getEdgesBySubject(agent);
        uint256 activeEdges = 0;
        for (uint256 i = 0; i < edges.length; i++) {
            if (RELATIONSHIP.edgeExists(edges[i])) {
                AgentRelationship.Edge memory e = RELATIONSHIP.getEdge(edges[i]);
                if (e.status == AgentRelationship.EdgeStatus.ACTIVE) activeEdges++;
            }
        }
        result.edgeCount = activeEdges;

        (uint256 avg, uint256 count) = REVIEWS.getAverageScore(agent);
        result.reviewCount = count;
        result.avgReviewScore = avg;
        result.openDisputes = DISPUTES.getOpenDisputeCount(agent);

        uint256 score = 0;
        if (activeEdges >= 2) score += 30;
        if (avg >= 70) score += 30;
        if (result.openDisputes == 0) score += 40;
        result.score = score;
        result.passes = score >= 60;
    }

    /**
     * @notice Quick trust check: passes if score >= threshold
     */
    function isTrusted(address agent, uint256 threshold) external view returns (bool) {
        bytes32[] memory edges = RELATIONSHIP.getEdgesBySubject(agent);
        uint256 activeEdges = 0;
        for (uint256 i = 0; i < edges.length; i++) {
            if (RELATIONSHIP.edgeExists(edges[i])) {
                AgentRelationship.Edge memory e = RELATIONSHIP.getEdge(edges[i]);
                if (e.status == AgentRelationship.EdgeStatus.ACTIVE) activeEdges++;
            }
        }

        (uint256 avg, uint256 count) = REVIEWS.getAverageScore(agent);
        uint256 openDisputes = DISPUTES.getOpenDisputeCount(agent);

        uint256 score = 0;
        if (activeEdges > 0) score += 25;
        if (activeEdges >= 3) score += 15;
        if (count >= 2) score += 15;
        if (avg >= 60) score += 25;
        if (openDisputes == 0) score += 20;

        return score >= threshold;
    }
}
