// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentReviewRecord
 * @notice Structured review claims with dimension scores.
 *
 * Reviews are claims by reviewers about an agent's performance across
 * multiple dimensions. Each dimension is scored 0-100.
 *
 * Dimensions: accuracy, reliability, responsiveness, compliance,
 *             safety, transparency, helpfulness
 *
 * Review types: performance, trust, quality, compliance, safety
 */
contract AgentReviewRecord {
    // ─── Review Types ───────────────────────────────────────────────

    bytes32 public constant REVIEW_PERFORMANCE = keccak256("PerformanceReview");
    bytes32 public constant REVIEW_TRUST = keccak256("TrustReview");
    bytes32 public constant REVIEW_QUALITY = keccak256("QualityReview");
    bytes32 public constant REVIEW_COMPLIANCE = keccak256("ComplianceReview");
    bytes32 public constant REVIEW_SAFETY = keccak256("SafetyReview");

    // ─── Recommendation Types ───────────────────────────────────────

    bytes32 public constant REC_ENDORSES = keccak256("endorses");
    bytes32 public constant REC_RECOMMENDS = keccak256("recommends");
    bytes32 public constant REC_NEUTRAL = keccak256("neutral");
    bytes32 public constant REC_FLAGS = keccak256("flags");
    bytes32 public constant REC_DISPUTES = keccak256("disputes");

    struct DimensionScore {
        bytes32 dimension;  // e.g., keccak256("accuracy")
        uint8 score;        // 0-100
    }

    struct Review {
        uint256 reviewId;
        address reviewer;
        address subject;           // agent being reviewed
        bytes32 reviewType;        // REVIEW_PERFORMANCE, etc.
        bytes32 recommendation;    // REC_ENDORSES, REC_FLAGS, etc.
        uint8 overallScore;        // 0-100
        string comment;            // review text or URI
        string evidenceURI;        // supporting evidence
        uint256 createdAt;
        bool revoked;
    }

    // ─── Dimension Constants ────────────────────────────────────────

    bytes32 public constant DIM_ACCURACY = keccak256("accuracy");
    bytes32 public constant DIM_RELIABILITY = keccak256("reliability");
    bytes32 public constant DIM_RESPONSIVENESS = keccak256("responsiveness");
    bytes32 public constant DIM_COMPLIANCE = keccak256("compliance");
    bytes32 public constant DIM_SAFETY = keccak256("safety");
    bytes32 public constant DIM_TRANSPARENCY = keccak256("transparency");
    bytes32 public constant DIM_HELPFULNESS = keccak256("helpfulness");

    // ─── Storage ────────────────────────────────────────────────────

    Review[] private _reviews;
    mapping(uint256 => DimensionScore[]) private _dimensions;
    mapping(address => uint256[]) private _bySubject;
    mapping(address => uint256[]) private _byReviewer;

    // ─── Events ─────────────────────────────────────────────────────

    event ReviewCreated(
        uint256 indexed reviewId,
        address indexed reviewer,
        address indexed subject,
        bytes32 reviewType,
        bytes32 recommendation,
        uint8 overallScore
    );

    event ReviewRevoked(uint256 indexed reviewId, address indexed revoker);

    error ReviewNotFound();
    error NotAuthorized();
    error AlreadyRevoked();
    error InvalidScore();

    // ─── Create ─────────────────────────────────────────────────────

    function createReview(
        address subject,
        bytes32 reviewType,
        bytes32 recommendation,
        uint8 overallScore,
        DimensionScore[] calldata dimensions,
        string calldata comment,
        string calldata evidenceURI
    ) external returns (uint256 reviewId) {
        if (overallScore > 100) revert InvalidScore();
        for (uint256 i = 0; i < dimensions.length; i++) {
            if (dimensions[i].score > 100) revert InvalidScore();
        }

        reviewId = _reviews.length;
        _reviews.push(Review({
            reviewId: reviewId,
            reviewer: msg.sender,
            subject: subject,
            reviewType: reviewType,
            recommendation: recommendation,
            overallScore: overallScore,
            comment: comment,
            evidenceURI: evidenceURI,
            createdAt: block.timestamp,
            revoked: false
        }));

        for (uint256 i = 0; i < dimensions.length; i++) {
            _dimensions[reviewId].push(dimensions[i]);
        }

        _bySubject[subject].push(reviewId);
        _byReviewer[msg.sender].push(reviewId);

        emit ReviewCreated(reviewId, msg.sender, subject, reviewType, recommendation, overallScore);
    }

    function revokeReview(uint256 reviewId) external {
        if (reviewId >= _reviews.length) revert ReviewNotFound();
        Review storage r = _reviews[reviewId];
        if (r.revoked) revert AlreadyRevoked();
        if (msg.sender != r.reviewer) revert NotAuthorized();
        r.revoked = true;
        emit ReviewRevoked(reviewId, msg.sender);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getReview(uint256 reviewId) external view returns (Review memory) {
        if (reviewId >= _reviews.length) revert ReviewNotFound();
        return _reviews[reviewId];
    }

    function getDimensions(uint256 reviewId) external view returns (DimensionScore[] memory) {
        return _dimensions[reviewId];
    }

    function getReviewsBySubject(address subject) external view returns (uint256[] memory) {
        return _bySubject[subject];
    }

    function getReviewsByReviewer(address reviewer) external view returns (uint256[] memory) {
        return _byReviewer[reviewer];
    }

    function reviewCount() external view returns (uint256) {
        return _reviews.length;
    }

    /**
     * @notice Get average overall score for a subject (non-revoked reviews only).
     */
    function getAverageScore(address subject) external view returns (uint256 avg, uint256 count) {
        uint256[] storage ids = _bySubject[subject];
        uint256 total = 0;
        count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            Review storage r = _reviews[ids[i]];
            if (!r.revoked) {
                total += r.overallScore;
                count++;
            }
        }
        if (count > 0) avg = total / count;
    }
}
