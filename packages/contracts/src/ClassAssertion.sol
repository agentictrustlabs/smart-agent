// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ClassAssertion
 * @notice Generic class-tagged assertion log for off-chain artifacts
 *         (intent-marketplace and beyond).
 *
 * Companion to AgentAssertion (which is edge-focused). ClassAssertion
 * anchors any class-tagged event whose subject is not necessarily an
 * agent-relationship edge:
 *
 *   sa:MatchInitiationAssertion        — links two intents
 *   sa:PledgeAssertion                 — links donor + pool (with amount)
 *   sa:PoolPledgedTotalAssertion       — aggregate on a pool, donor-less
 *   sa:RoundOpenedAssertion            — round lifecycle event
 *   sa:RoundClosedAssertion            — round lifecycle event
 *
 * Each assertion carries:
 *   classId    — keccak256 of the class IRI (off-chain pre-computed)
 *   subjectId  — keccak256 of the subject IRI (the artifact's own IRI;
 *                for relationships, callers compose subject + object IRIs)
 *   payloadURI — off-chain content reference (JSON / IPFS / data: URI);
 *                the on-chain → GraphDB sync ingests this.
 *
 * Privacy: This contract anchors PUBLIC-tier artifacts only. Callers MUST
 * NOT call it for private-tier artifacts (e.g., sa:GrantProposal in v1,
 * anonymous PoolPledges, MatchInitiations referencing a private intent).
 * SHACL shapes in docs/ontology/tbox/shacl/visibility.ttl document the
 * privacy invariants; enforcement is in the calling MCP.
 *
 * No relationship-edge dependency — a ClassAssertion can exist for any
 * subject, including artifacts that have no representation in
 * AgentRelationship (intents, pools, rounds, pledges, proposals).
 */
contract ClassAssertion {
    struct AssertionRecord {
        uint256 assertionId;
        bytes32 classId;
        bytes32 subjectId;
        address asserter;
        uint256 validFrom;
        uint256 validUntil;
        bool revoked;
        string payloadURI;
    }

    AssertionRecord[] private _assertions;
    mapping(bytes32 => uint256[]) private _assertionsByClass;
    mapping(bytes32 => uint256[]) private _assertionsBySubject;
    mapping(address => uint256[]) private _assertionsByAsserter;

    // ─── Events ─────────────────────────────────────────────────────

    event ClassAssertionMade(
        uint256 indexed assertionId,
        bytes32 indexed classId,
        bytes32 indexed subjectId,
        address asserter,
        uint256 validFrom,
        uint256 validUntil,
        string payloadURI
    );

    event ClassAssertionRevoked(uint256 indexed assertionId, address indexed revoker);

    // ─── Errors ─────────────────────────────────────────────────────

    error AssertionNotFound();
    error AlreadyRevoked();
    error NotAuthorized();
    error InvalidAssertion();

    // ─── Assert ─────────────────────────────────────────────────────

    /**
     * @notice Anchor a class-tagged assertion on chain.
     * @param classId    keccak256 of the assertion class IRI (e.g., sa:MatchInitiationAssertion).
     * @param subjectId  keccak256 of the subject IRI (the artifact's IRI).
     * @param validFrom  Unix seconds; 0 → block.timestamp.
     * @param validUntil Unix seconds; 0 → never expires.
     * @param payloadURI Off-chain content reference. Indexed by the GraphDB sync.
     * @return assertionId The newly minted id.
     */
    function assertClass(
        bytes32 classId,
        bytes32 subjectId,
        uint256 validFrom,
        uint256 validUntil,
        string calldata payloadURI
    ) external returns (uint256 assertionId) {
        if (classId == bytes32(0) || subjectId == bytes32(0)) revert InvalidAssertion();
        if (validUntil != 0 && validFrom != 0 && validUntil < validFrom) revert InvalidAssertion();

        uint256 effectiveValidFrom = validFrom == 0 ? block.timestamp : validFrom;

        assertionId = _assertions.length;
        _assertions.push(AssertionRecord({
            assertionId: assertionId,
            classId: classId,
            subjectId: subjectId,
            asserter: msg.sender,
            validFrom: effectiveValidFrom,
            validUntil: validUntil,
            revoked: false,
            payloadURI: payloadURI
        }));

        _assertionsByClass[classId].push(assertionId);
        _assertionsBySubject[subjectId].push(assertionId);
        _assertionsByAsserter[msg.sender].push(assertionId);

        emit ClassAssertionMade(
            assertionId, classId, subjectId, msg.sender, effectiveValidFrom, validUntil, payloadURI
        );
    }

    // ─── Revoke ─────────────────────────────────────────────────────

    function revokeAssertion(uint256 assertionId) external {
        if (assertionId >= _assertions.length) revert AssertionNotFound();
        AssertionRecord storage a = _assertions[assertionId];
        if (a.revoked) revert AlreadyRevoked();
        if (msg.sender != a.asserter) revert NotAuthorized();

        a.revoked = true;
        emit ClassAssertionRevoked(assertionId, msg.sender);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getAssertion(uint256 assertionId) external view returns (AssertionRecord memory) {
        if (assertionId >= _assertions.length) revert AssertionNotFound();
        return _assertions[assertionId];
    }

    function getAssertionsByClass(bytes32 classId) external view returns (uint256[] memory) {
        return _assertionsByClass[classId];
    }

    function getAssertionsBySubject(bytes32 subjectId) external view returns (uint256[] memory) {
        return _assertionsBySubject[subjectId];
    }

    function getAssertionsByAsserter(address asserter) external view returns (uint256[] memory) {
        return _assertionsByAsserter[asserter];
    }

    function assertionCount() external view returns (uint256) {
        return _assertions.length;
    }

    function isAssertionCurrentlyValid(uint256 assertionId) public view returns (bool) {
        if (assertionId >= _assertions.length) revert AssertionNotFound();
        AssertionRecord storage a = _assertions[assertionId];

        if (a.revoked) return false;
        if (block.timestamp < a.validFrom) return false;
        if (a.validUntil != 0 && block.timestamp > a.validUntil) return false;

        return true;
    }
}
