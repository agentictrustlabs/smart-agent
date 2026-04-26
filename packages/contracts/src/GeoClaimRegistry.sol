// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./GeoFeatureRegistry.sol";

/**
 * @title GeoClaimRegistry
 * @notice Index over geographic claims an agent makes about a feature.
 *
 * This contract is small on purpose. It does NOT replace the public trust
 * graph (`AgentRelationship`) or provenance (`AgentAssertion`) — public
 * geo claims SHOULD also create an edge + assertion via the existing
 * substrate, and reference them here via `edgeId` and `assertionId`. The
 * point of the dedicated registry is:
 *
 *   • Versioned binding to a feature: a claim references a specific
 *     (featureId, featureVersion). Boundary changes don't silently
 *     re-target old claims.
 *   • Visibility modes from day one — public, public-coarse, private-
 *     commitment, private-zk, offchain-only — so we never end up with
 *     exact addresses or receipts in SQL or on-chain metadata.
 *   • An evidence commitment (`evidenceCommit`) that ZK proofs can later
 *     verify against (e.g. the holder proves H3-membership-in-coverage
 *     against this same commit).
 *   • A relation enum so a verifier can discriminate "lives there" from
 *     "served a task there" from "is the steward of" in a single query.
 *
 *   ⚠ Locked-in policy id: `smart-agent.geo-overlap.v1`. Not used here
 *     directly (scoring is off-chain), but the policy field on each claim
 *     records which scoring policy it was minted under so future-policy
 *     scores can be recomputed deterministically.
 */
contract GeoClaimRegistry {

    // ─── Relation kinds ─────────────────────────────────────────────

    bytes32 public constant SERVES_WITHIN          = keccak256("geo:servesWithin");
    bytes32 public constant OPERATES_IN            = keccak256("geo:operatesIn");
    bytes32 public constant LICENSED_IN            = keccak256("geo:licensedIn");
    bytes32 public constant COMPLETED_TASK_IN      = keccak256("geo:completedTaskIn");
    bytes32 public constant VALIDATED_PRESENCE_IN  = keccak256("geo:validatedPresenceIn");
    bytes32 public constant STEWARD_OF             = keccak256("geo:stewardOf");
    bytes32 public constant RESIDENT_OF            = keccak256("geo:residentOf");
    bytes32 public constant ORIGIN_IN              = keccak256("geo:originIn");

    // ─── Visibility ─────────────────────────────────────────────────

    /// `public`             — claim payload is fully on-chain / offchain-public.
    /// `publicCoarse`       — feature visible, exact location coarsened (e.g. county only).
    /// `privateCommitment`  — only `evidenceCommit` is public; preimage stays in vault.
    /// `privateZk`          — `evidenceCommit` plus a verifier address; ZK proofs prove
    ///                        membership / proximity without revealing preimage.
    /// `offchainOnly`       — anchored elsewhere; on-chain row is a thin reference.
    enum Visibility { Public, PublicCoarse, PrivateCommitment, PrivateZk, OffchainOnly }

    // ─── Types ──────────────────────────────────────────────────────

    struct GeoClaim {
        bytes32 claimId;          // keccak256(subject ‖ feature ‖ relation ‖ nonce)
        address subjectAgent;     // who the claim is about
        address issuer;           // who issued the claim (self / org / validator)
        bytes32 featureId;
        uint64  featureVersion;   // pinned version — boundary changes don't retroactively re-target
        bytes32 relation;         // SERVES_WITHIN, RESIDENT_OF, …
        Visibility visibility;
        bytes32 evidenceCommit;   // commitment over the holder's preimage
                                  // (e.g. H3 cell + path) — ZK-targetable
        // Provenance hooks into the existing substrate. Either or both may
        // be zero when the claim is private-only.
        bytes32 edgeId;           // AgentRelationship edge id, or bytes32(0)
        bytes32 assertionId;      // AgentAssertion id, or bytes32(0)
        // Numeric metadata.
        uint8   confidence;       // 0..100; 100 = strongest issuer assertion
        bytes32 policyId;         // hash of scoring policy id ("smart-agent.geo-overlap.v1")
        // Validity window (unix seconds; 0 = open-ended).
        uint64  validAfter;
        uint64  validUntil;
        // Lifecycle.
        bool    revoked;
        uint64  createdAt;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error ClaimExists();
    error ClaimNotFound();
    error FeatureMissing();
    error InvalidVisibility();

    // ─── Events ─────────────────────────────────────────────────────

    event ClaimMinted(
        bytes32 indexed claimId,
        address indexed subjectAgent,
        bytes32 indexed featureId,
        uint64  featureVersion,
        bytes32 relation,
        address issuer,
        Visibility visibility
    );
    event ClaimRevoked(bytes32 indexed claimId, address indexed by);
    event ClaimEvidenceUpdated(bytes32 indexed claimId, bytes32 newCommit);

    // ─── State ──────────────────────────────────────────────────────

    GeoFeatureRegistry public immutable FEATURES;

    mapping(bytes32 => GeoClaim) private _claims;
    mapping(address => bytes32[]) private _claimsBySubject;
    mapping(bytes32 => bytes32[]) private _claimsByFeature;
    mapping(bytes32 => bytes32[]) private _claimsByRelation;

    // ─── Constructor ────────────────────────────────────────────────

    constructor(GeoFeatureRegistry features) {
        FEATURES = features;
    }

    // ─── Mint ───────────────────────────────────────────────────────

    /**
     * @notice Mint a geo claim.
     * @dev Authorization rules per visibility:
     *      • Public, PublicCoarse, OffchainOnly: caller must be subject or issuer
     *        (matches AgentAssertion semantics).
     *      • PrivateCommitment, PrivateZk: caller must be subject. The issuer
     *        field still records who endorsed the commitment off-chain, but
     *        the on-chain write is the holder's act.
     */
    function mint(
        address subjectAgent,
        address issuer,
        bytes32 featureId,
        uint64 featureVersion,
        bytes32 relation,
        Visibility visibility,
        bytes32 evidenceCommit,
        bytes32 edgeId,
        bytes32 assertionId,
        uint8 confidence,
        bytes32 policyId,
        uint64 validAfter,
        uint64 validUntil,
        bytes32 nonce
    ) external returns (bytes32 claimId) {
        // The feature MUST exist at the version pinned in the claim; otherwise
        // future validations have nothing to anchor against.
        FEATURES.getFeature(featureId, featureVersion);

        if (visibility == Visibility.PrivateCommitment || visibility == Visibility.PrivateZk) {
            if (!_isAuthorized(subjectAgent)) revert NotAuthorized();
        } else {
            if (!_isAuthorized(subjectAgent) && !_isAuthorized(issuer)) revert NotAuthorized();
        }

        claimId = keccak256(abi.encodePacked(subjectAgent, featureId, relation, nonce));
        if (_claims[claimId].createdAt != 0) revert ClaimExists();

        _claims[claimId] = GeoClaim({
            claimId: claimId,
            subjectAgent: subjectAgent,
            issuer: issuer,
            featureId: featureId,
            featureVersion: featureVersion,
            relation: relation,
            visibility: visibility,
            evidenceCommit: evidenceCommit,
            edgeId: edgeId,
            assertionId: assertionId,
            confidence: confidence,
            policyId: policyId,
            validAfter: validAfter,
            validUntil: validUntil,
            revoked: false,
            createdAt: uint64(block.timestamp)
        });

        _claimsBySubject[subjectAgent].push(claimId);
        _claimsByFeature[featureId].push(claimId);
        _claimsByRelation[relation].push(claimId);

        emit ClaimMinted(claimId, subjectAgent, featureId, featureVersion, relation, issuer, visibility);
    }

    function revoke(bytes32 claimId) external {
        GeoClaim storage c = _claims[claimId];
        if (c.createdAt == 0) revert ClaimNotFound();
        // Subject OR issuer can revoke. (Mirrors AgentAssertion's dispute path.)
        if (!_isAuthorized(c.subjectAgent) && !_isAuthorized(c.issuer)) revert NotAuthorized();
        c.revoked = true;
        emit ClaimRevoked(claimId, msg.sender);
    }

    /// @notice Re-anchor the evidence commitment (e.g. after a key rotation).
    function setEvidenceCommit(bytes32 claimId, bytes32 newCommit) external {
        GeoClaim storage c = _claims[claimId];
        if (c.createdAt == 0) revert ClaimNotFound();
        if (!_isAuthorized(c.subjectAgent)) revert NotAuthorized();
        c.evidenceCommit = newCommit;
        emit ClaimEvidenceUpdated(claimId, newCommit);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getClaim(bytes32 claimId) external view returns (GeoClaim memory) {
        GeoClaim storage c = _claims[claimId];
        if (c.createdAt == 0) revert ClaimNotFound();
        return c;
    }

    function claimsBySubject(address subject) external view returns (bytes32[] memory) {
        return _claimsBySubject[subject];
    }
    function claimsByFeature(bytes32 featureId) external view returns (bytes32[] memory) {
        return _claimsByFeature[featureId];
    }
    function claimsByRelation(bytes32 relation) external view returns (bytes32[] memory) {
        return _claimsByRelation[relation];
    }

    // ─── Auth ───────────────────────────────────────────────────────

    function _isAuthorized(address account) internal view returns (bool) {
        if (msg.sender == account) return true;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        return ok && abi.decode(data, (bool));
    }
}
