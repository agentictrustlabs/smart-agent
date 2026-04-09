// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentRelationship.sol";

/**
 * @title AgentAssertion
 * @notice Provenance and claim layer for relationship edges.
 *
 * Assertions are speech acts: an asserter claims something about a relationship edge.
 * The resolver decides whether one or more assertions qualify the edge as active/trusted.
 *
 * Assertion types represent different trust patterns:
 * - SELF_ASSERTED: subject claims the relationship
 * - OBJECT_ASSERTED: object (authority) confirms the relationship
 * - MUTUAL_CONFIRMATION: both parties confirm
 * - VALIDATOR_ASSERTED: trusted third-party validator confirms
 * - ORG_ASSERTED: organization-level assertion
 * - APP_ASSERTED: app/runtime assertion
 */
contract AgentAssertion {
    enum AssertionType {
        NONE,
        SELF_ASSERTED,
        OBJECT_ASSERTED,
        MUTUAL_CONFIRMATION,
        VALIDATOR_ASSERTED,
        ORG_ASSERTED,
        APP_ASSERTED
    }

    struct AssertionRecord {
        uint256 assertionId;
        bytes32 edgeId;
        AssertionType assertionType;
        address asserter;
        uint256 validFrom;
        uint256 validUntil;
        bool revoked;
        string evidenceURI;
    }

    AgentRelationship public immutable RELATIONSHIP;

    AssertionRecord[] private _assertions;
    mapping(bytes32 => uint256[]) private _assertionsByEdge;
    mapping(address => uint256[]) private _assertionsByAsserter;

    // ─── Events ─────────────────────────────────────────────────────

    event AssertionMade(
        uint256 indexed assertionId,
        bytes32 indexed edgeId,
        AssertionType assertionType,
        address indexed asserter,
        uint256 validFrom,
        uint256 validUntil,
        string evidenceURI
    );

    event AssertionRevoked(uint256 indexed assertionId, address indexed revoker);

    // ─── Errors ─────────────────────────────────────────────────────

    error EdgeNotFound();
    error AssertionNotFound();
    error AlreadyRevoked();
    error InvalidAssertion();
    error NotAuthorized();

    constructor(address relationshipAddress) {
        RELATIONSHIP = AgentRelationship(relationshipAddress);
    }

    // ─── Assert ─────────────────────────────────────────────────────

    function makeAssertion(
        bytes32 edgeId,
        AssertionType assertionType,
        uint256 validFrom,
        uint256 validUntil,
        string calldata evidenceURI
    ) external returns (uint256 assertionId) {
        if (!RELATIONSHIP.edgeExists(edgeId)) revert EdgeNotFound();
        if (assertionType == AssertionType.NONE) revert InvalidAssertion();
        if (validUntil != 0 && validFrom != 0 && validUntil < validFrom) revert InvalidAssertion();

        uint256 effectiveValidFrom = validFrom == 0 ? block.timestamp : validFrom;

        assertionId = _assertions.length;
        _assertions.push(AssertionRecord({
            assertionId: assertionId,
            edgeId: edgeId,
            assertionType: assertionType,
            asserter: msg.sender,
            validFrom: effectiveValidFrom,
            validUntil: validUntil,
            revoked: false,
            evidenceURI: evidenceURI
        }));

        _assertionsByEdge[edgeId].push(assertionId);
        _assertionsByAsserter[msg.sender].push(assertionId);

        emit AssertionMade(assertionId, edgeId, assertionType, msg.sender, effectiveValidFrom, validUntil, evidenceURI);
    }

    // ─── Revoke ─────────────────────────────────────────────────────

    function revokeAssertion(uint256 assertionId) external {
        if (assertionId >= _assertions.length) revert AssertionNotFound();
        AssertionRecord storage a = _assertions[assertionId];
        if (a.revoked) revert AlreadyRevoked();
        if (msg.sender != a.asserter) revert NotAuthorized();

        a.revoked = true;
        emit AssertionRevoked(assertionId, msg.sender);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getAssertion(uint256 assertionId) external view returns (AssertionRecord memory) {
        if (assertionId >= _assertions.length) revert AssertionNotFound();
        return _assertions[assertionId];
    }

    function getAssertionsByEdge(bytes32 edgeId) external view returns (uint256[] memory) {
        return _assertionsByEdge[edgeId];
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
