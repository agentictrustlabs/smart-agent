// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentAccountResolver.sol";
import "./AgentRelationship.sol";
import "./AgentReviewRecord.sol";
import "./AgentDisputeRecord.sol";
import "./AgentValidationProfile.sol";
import "./AgentTrustProfile.sol";
import "./AgentPredicates.sol";

/**
 * @title AgentUniversalResolver
 * @notice Single read façade for all agent data.
 *
 * Aggregates metadata from AgentAccountResolver, trust scores from
 * AgentTrustProfile, and counts from relationship/review/validation/dispute
 * contracts into one view call.
 *
 * This is what wallets, explorers, and discovery services should call
 * to get a complete picture of an agent.
 */
contract AgentUniversalResolver {
    AgentAccountResolver public immutable RESOLVER;
    AgentRelationship public immutable RELATIONSHIPS;
    AgentReviewRecord public immutable REVIEWS;
    AgentDisputeRecord public immutable DISPUTES;
    AgentValidationProfile public immutable VALIDATIONS;
    AgentTrustProfile public immutable TRUST;

    struct AgentProfile {
        // Identity (from resolver)
        string displayName;
        string description;
        bytes32 agentType;
        bytes32 agentClass;
        string metadataURI;
        bytes32 metadataHash;
        string schemaURI;
        bool active;
        uint256 registeredAt;

        // Trust scores
        bool discoveryTrustPasses;
        uint256 discoveryTrustScore;
        bool executionTrustPasses;
        uint256 executionTrustScore;
        bool runtimeTrustPasses;
        uint256 runtimeTrustScore;

        // Counts
        uint256 reviewCount;
        uint256 avgReviewScore;
        uint256 validationCount;
        uint256 openDisputeCount;
    }

    constructor(
        address resolver,
        address relationships,
        address reviews,
        address disputes,
        address validations,
        address trust
    ) {
        RESOLVER = AgentAccountResolver(resolver);
        RELATIONSHIPS = AgentRelationship(relationships);
        REVIEWS = AgentReviewRecord(reviews);
        DISPUTES = AgentDisputeRecord(disputes);
        VALIDATIONS = AgentValidationProfile(validations);
        TRUST = AgentTrustProfile(trust);
    }

    /**
     * @notice Resolve a complete agent profile in one call.
     */
    function resolveAgent(address agent) external view returns (AgentProfile memory profile) {
        // Core metadata
        if (RESOLVER.isRegistered(agent)) {
            AgentAccountResolver.CoreRecord memory core = RESOLVER.getCore(agent);
            profile.displayName = core.displayName;
            profile.description = core.description;
            profile.agentType = core.agentType;
            profile.agentClass = core.agentClass;
            profile.metadataURI = core.metadataURI;
            profile.metadataHash = core.metadataHash;
            profile.schemaURI = core.schemaURI;
            profile.active = core.active;
            profile.registeredAt = core.registeredAt;
        }

        // Trust scores
        try TRUST.checkDiscoveryTrust(agent) returns (AgentTrustProfile.TrustResult memory dt) {
            profile.discoveryTrustPasses = dt.passes;
            profile.discoveryTrustScore = dt.score;
        } catch {}

        try TRUST.checkExecutionTrust(agent) returns (AgentTrustProfile.TrustResult memory et) {
            profile.executionTrustPasses = et.passes;
            profile.executionTrustScore = et.score;
        } catch {}

        try TRUST.checkRuntimeTrust(agent) returns (AgentTrustProfile.TrustResult memory rt) {
            profile.runtimeTrustPasses = rt.passes;
            profile.runtimeTrustScore = rt.score;
        } catch {}

        // Reviews
        try REVIEWS.getAverageScore(agent) returns (uint256 avg, uint256 count) {
            profile.reviewCount = count;
            profile.avgReviewScore = avg;
        } catch {}

        // Validations
        try VALIDATIONS.getValidationsByAgent(agent) returns (uint256[] memory valIds) {
            profile.validationCount = valIds.length;
        } catch {}

        // Disputes
        try DISPUTES.getOpenDisputeCount(agent) returns (uint256 count) {
            profile.openDisputeCount = count;
        } catch {}
    }

    /**
     * @notice Resolve specific string properties by predicate.
     */
    function resolveProperties(
        address agent,
        bytes32[] calldata predicates
    ) external view returns (string[] memory values) {
        values = new string[](predicates.length);
        for (uint256 i = 0; i < predicates.length; i++) {
            values[i] = RESOLVER.getStringProperty(agent, predicates[i]);
        }
    }

    /**
     * @notice Check if an agent is registered in the resolver.
     */
    function isRegistered(address agent) external view returns (bool) {
        return RESOLVER.isRegistered(agent);
    }

    /**
     * @notice Get total registered agent count.
     */
    function agentCount() external view returns (uint256) {
        return RESOLVER.agentCount();
    }
}
