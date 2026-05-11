// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

/**
 * @title MatchInitiationRegistry
 * @notice On-chain authoritative store for the Direct Lane (spec 001)
 *         match-initiation primitive. Replaces the org-mcp `match_initiations`
 *         table + the optional sa:MatchInitiationAssertion class-assertion
 *         anchor — every match initiation now lands here.
 *
 * Subject = keccak256("sa:matchInitiation:", viewedIntent, candidateIntent, initiatorNullifier).
 * Distinct (viewer, candidate, initiator-credential) triples produce
 * distinct subjects; the same initiator re-creating against the same pair
 * UPDATEs the row.
 *
 * The two intent ids are stored as ASCII strings (URN-shaped) so callers
 * don't need to pre-hash them. visibility is a concept hash matching
 * the existing `MatchInitiationVisibility` enum.
 *
 * Auth: only the initiator's home org-mcp account (proxying for the
 * holder of the initiating credential) can write. Same publisher model
 * as VoteRegistry / ProposalRegistry — the org-mcp's session delegation
 * is the on-chain writer.
 */
contract MatchInitiationRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_MATCH_INITIATION = keccak256("sa:MatchInitiation");

    bytes32 public constant SA_MI_VIEWED_INTENT       = keccak256("sa:miViewedIntent");
    bytes32 public constant SA_MI_CANDIDATE_INTENT    = keccak256("sa:miCandidateIntent");
    bytes32 public constant SA_MI_INITIATOR_NULLIFIER = keccak256("sa:miInitiatorNullifier");
    bytes32 public constant SA_MI_INITIATION_KIND     = keccak256("sa:miInitiationKind"); // self/connector
    bytes32 public constant SA_MI_VISIBILITY          = keccak256("sa:miVisibility");
    bytes32 public constant SA_MI_STATUS              = keccak256("sa:miStatus");         // pending/consumed/superseded
    bytes32 public constant SA_MI_BASIS               = keccak256("sa:miBasis");          // JSON
    bytes32 public constant SA_MI_PROPOSED_AT         = keccak256("sa:miProposedAt");
    bytes32 public constant SA_MI_UPDATED_AT          = keccak256("sa:miUpdatedAt");

    error NotInitiator();
    error MatchInitiationNotFound();

    event MatchInitiationCreated(
        bytes32 indexed miSubject,
        bytes32 indexed initiatorNullifier,
        bytes32 visibility
    );
    event MatchInitiationStatusChanged(bytes32 indexed miSubject, bytes32 newStatus);

    struct CreateParams {
        string  viewedIntentId;        // URN
        string  candidateIntentId;     // URN
        bytes32 initiatorNullifier;    // AnonCreds initiator credential
        bytes32 initiationKind;        // concept hash: sa:Self | sa:Connector
        bytes32 visibility;            // concept hash
        string  basisJson;
        address publisher;             // the org-mcp AgentAccount publishing this row;
                                       // used as the auth principal for later mutations
    }

    constructor(address ontologyRegistry, address shapes)
        AttributeStorage(ontologyRegistry)
    {
        SHAPES = ShapeRegistry(shapes);
    }

    function _miSubject(
        string memory viewedIntentId,
        string memory candidateIntentId,
        bytes32 initiatorNullifier
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            "sa:matchInitiation:",
            viewedIntentId, ":",
            candidateIntentId, ":",
            initiatorNullifier
        ));
    }

    function miSubject(
        string calldata viewedIntentId,
        string calldata candidateIntentId,
        bytes32 initiatorNullifier
    ) external pure returns (bytes32) {
        return _miSubject(viewedIntentId, candidateIntentId, initiatorNullifier);
    }

    function _isAccountOwner(address account, address actor) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", actor)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    function create(CreateParams calldata p) external {
        if (!_isAccountOwner(p.publisher, msg.sender)) revert NotInitiator();
        bytes32 subj = _miSubject(p.viewedIntentId, p.candidateIntentId, p.initiatorNullifier);
        _setString(subj, SA_MI_VIEWED_INTENT, p.viewedIntentId);
        _setString(subj, SA_MI_CANDIDATE_INTENT, p.candidateIntentId);
        _setBytes32(subj, SA_MI_INITIATOR_NULLIFIER, p.initiatorNullifier);
        _setBytes32(subj, SA_MI_INITIATION_KIND, p.initiationKind);
        _setBytes32(subj, SA_MI_VISIBILITY, p.visibility);
        _setBytes32(subj, SA_MI_STATUS, keccak256("sa:MatchInitiationPending"));
        if (bytes(p.basisJson).length > 0) _setString(subj, SA_MI_BASIS, p.basisJson);
        _setUint(subj, SA_MI_PROPOSED_AT, block.timestamp);
        _setUint(subj, SA_MI_UPDATED_AT, block.timestamp);
        SHAPES.validateSubject(CLASS_MATCH_INITIATION, subj, address(this));
        emit MatchInitiationCreated(subj, p.initiatorNullifier, p.visibility);
    }

    function setStatus(bytes32 miSubj, bytes32 newStatus, address publisher) external {
        if (!_isAccountOwner(publisher, msg.sender)) revert NotInitiator();
        bytes32 viewed = keccak256(bytes(this.getString(miSubj, SA_MI_VIEWED_INTENT)));
        if (viewed == keccak256(bytes(""))) revert MatchInitiationNotFound();
        _setBytes32(miSubj, SA_MI_STATUS, newStatus);
        _setUint(miSubj, SA_MI_UPDATED_AT, block.timestamp);
        emit MatchInitiationStatusChanged(miSubj, newStatus);
    }
}
