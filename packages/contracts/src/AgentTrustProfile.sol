// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRelationship.sol";
import "./AgentReviewRecord.sol";
import "./AgentDisputeRecord.sol";
import "./AgentValidationProfile.sol";

/**
 * @title AgentTrustProfile
 * @notice Context-specific trust resolution profiles.
 *
 * Answers: "What facts count toward trust in a given context?"
 *
 * Profiles:
 * - Discovery Trust: does the agent have org control + reviews + no disputes?
 * - Execution Trust: does the agent have delegation authority + TEE + reviews + no disputes?
 * - Runtime Trust: does the agent have TEE attestation + build provenance?
 */
contract AgentTrustProfile {
    AgentRelationship public immutable RELATIONSHIP;
    AgentReviewRecord public immutable REVIEWS;
    AgentDisputeRecord public immutable DISPUTES;
    AgentValidationProfile public immutable VALIDATIONS;

    constructor(address relationship, address reviews, address disputes, address validations) {
        RELATIONSHIP = AgentRelationship(relationship);
        REVIEWS = AgentReviewRecord(reviews);
        DISPUTES = AgentDisputeRecord(disputes);
        VALIDATIONS = AgentValidationProfile(validations);
    }

    struct TrustResult {
        bool passes;
        uint256 score;           // 0-100
        uint256 edgeCount;
        uint256 reviewCount;
        uint256 avgReviewScore;
        uint256 openDisputes;
        uint256 validationCount; // TEE validations
    }

    /**
     * @notice Check discovery trust: org control + reviews + no disputes
     */
    function checkDiscoveryTrust(address agent) external view returns (TrustResult memory result) {
        _loadBaseMetrics(agent, result);

        uint256 score = 0;
        if (result.edgeCount > 0) score += 25;
        if (result.reviewCount >= 2) score += 20;
        if (result.avgReviewScore >= 60) score += 25;
        if (result.openDisputes == 0) score += 15;
        if (result.validationCount > 0) score += 15; // TEE adds trust
        result.score = score;
        result.passes = score >= 50;
    }

    /**
     * @notice Check execution trust: delegation + TEE + reviews + no disputes
     *         TEE validation is a significant factor — an agent running in a TEE
     *         with verified code integrity is more trustworthy for execution.
     */
    function checkExecutionTrust(address agent) external view returns (TrustResult memory result) {
        _loadBaseMetrics(agent, result);

        uint256 score = 0;
        if (result.edgeCount >= 2) score += 20;
        if (result.avgReviewScore >= 70) score += 20;
        if (result.openDisputes == 0) score += 20;
        if (result.validationCount > 0) score += 25;  // TEE is critical for execution trust
        if (result.reviewCount >= 1) score += 15;
        result.score = score;
        result.passes = score >= 60;
    }

    /**
     * @notice Check runtime trust: TEE attestation + relationships
     *         Focused on whether the agent's runtime environment is verified.
     */
    function checkRuntimeTrust(address agent) external view returns (TrustResult memory result) {
        _loadBaseMetrics(agent, result);

        uint256 score = 0;
        if (result.validationCount > 0) score += 40;  // TEE is primary factor
        if (result.validationCount >= 2) score += 10;  // multiple validations = more confidence
        if (result.edgeCount > 0) score += 15;
        if (result.openDisputes == 0) score += 15;
        if (result.avgReviewScore >= 60) score += 20;
        result.score = score;
        result.passes = score >= 50;
    }

    /**
     * @notice Quick trust check: passes if score >= threshold
     */
    function isTrusted(address agent, uint256 threshold) external view returns (bool) {
        TrustResult memory result;
        _loadBaseMetrics(agent, result);

        uint256 score = 0;
        if (result.edgeCount > 0) score += 20;
        if (result.edgeCount >= 3) score += 10;
        if (result.reviewCount >= 2) score += 15;
        if (result.avgReviewScore >= 60) score += 20;
        if (result.openDisputes == 0) score += 15;
        if (result.validationCount > 0) score += 20;

        return score >= threshold;
    }

    /**
     * @dev Load all base metrics for an agent in one pass.
     */
    function _loadBaseMetrics(address agent, TrustResult memory result) internal view {
        // Active relationship edges
        bytes32[] memory edges = RELATIONSHIP.getEdgesBySubject(agent);
        uint256 activeEdges = 0;
        for (uint256 i = 0; i < edges.length; i++) {
            if (RELATIONSHIP.edgeExists(edges[i])) {
                AgentRelationship.Edge memory e = RELATIONSHIP.getEdge(edges[i]);
                if (e.status == AgentRelationship.EdgeStatus.ACTIVE) activeEdges++;
            }
        }
        result.edgeCount = activeEdges;

        // Reviews
        (uint256 avg, uint256 count) = REVIEWS.getAverageScore(agent);
        result.reviewCount = count;
        result.avgReviewScore = avg;

        // Disputes
        result.openDisputes = DISPUTES.getOpenDisputeCount(agent);

        // TEE validations
        uint256[] memory valIds = VALIDATIONS.getValidationsByAgent(agent);
        result.validationCount = valIds.length;
    }
}
