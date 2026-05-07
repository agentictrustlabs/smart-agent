// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyAttributeStore.sol";
import "./ShapeRegistry.sol";

/**
 * @title ProposalRegistry
 * @notice Phase 0.5 — public-facet registry for awarded grant proposals.
 *
 * Privacy invariant (per sa:GrantProposalAlwaysPrivateShape in
 * docs/ontology/tbox/shacl/visibility.ttl): the proposal *body* — narrative,
 * detailed budget, milestones — must never anchor on chain. Bodies stay in
 * person-mcp `proposal_submissions`.
 *
 * The on-chain class for entries here is `sa:GrantProposalPublicFacet`, a
 * separate ontology class from `sa:GrantProposal`. The shape only permits
 * statuses that imply the proposal has *already become public* — Awarded,
 * Declined, Rescinded. Submitted is intentionally absent.
 *
 * Subject id derivation:
 *     subject = keccak256(abi.encodePacked("sa:proposal:", proposalId))
 *
 * Auth: announceAward and setStatus require the caller to own the awarding
 * fund's AgentAccount. The awarding fund is recorded as
 * sa:proposalAwardingFund at announce time so subsequent mutations can
 * verify against it.
 */
contract ProposalRegistry {
    OntologyAttributeStore public immutable STORE;
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_PROPOSAL_PUBLIC_FACET = keccak256("sa:GrantProposalPublicFacet");

    bytes32 public constant SA_PROPOSAL_KIND             = keccak256("sa:proposalKind");
    bytes32 public constant SA_PROPOSAL_STATUS           = keccak256("sa:proposalStatus");
    bytes32 public constant SA_PROPOSAL_BASED_ON_INTENT  = keccak256("sa:proposalBasedOnIntentId");
    bytes32 public constant SA_PROPOSAL_ROUND            = keccak256("sa:proposalRound");
    bytes32 public constant SA_PROPOSAL_PROPOSER         = keccak256("sa:proposalProposer");
    bytes32 public constant SA_PROPOSAL_RECIPIENT        = keccak256("sa:proposalRecipient");
    bytes32 public constant SA_PROPOSAL_TOTAL_AWARDED    = keccak256("sa:proposalTotalAwarded");
    bytes32 public constant SA_PROPOSAL_AWARDED_AT       = keccak256("sa:proposalAwardedAt");
    bytes32 public constant SA_PROPOSAL_BODY_HASH        = keccak256("sa:proposalBodyHash");
    bytes32 public constant SA_PROPOSAL_AWARDING_FUND    = keccak256("sa:proposalAwardingFund");

    error NotFundOwner();
    error ProposalNotInitialized();
    error ProposalAlreadyAnnounced();

    event ProposalAwardAnnounced(bytes32 indexed proposalSubject, bytes32 round, uint256 totalAwarded);
    event ProposalStatusChanged(bytes32 indexed proposalSubject, bytes32 newStatus);

    struct AnnounceParams {
        bytes32 proposalSubject;
        bytes32 kind;
        bytes32 basedOnIntentId;
        bytes32 round;
        address proposer;
        address recipient;
        uint256 totalAwarded;
        bytes32 bodyHash;
        address awardingFund;
        bytes32 status;
    }

    constructor(address store, address shapes) {
        STORE = OntologyAttributeStore(store);
        SHAPES = ShapeRegistry(shapes);
    }

    /// @notice Compute the canonical proposal subject id for an off-chain id.
    function proposalSubject(string calldata proposalId) external pure returns (bytes32) {
        return keccak256(abi.encodePacked("sa:proposal:", proposalId));
    }

    function _isAccountOwner(address account, address actor) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", actor)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    modifier onlyFundOwner(address fundAgent) {
        if (!_isAccountOwner(fundAgent, msg.sender)) revert NotFundOwner();
        _;
    }

    modifier onlyAwardingFundOwner(bytes32 proposal) {
        if (!STORE.isSet(proposal, SA_PROPOSAL_AWARDING_FUND)) revert ProposalNotInitialized();
        address awardingFund = STORE.getAddress(proposal, SA_PROPOSAL_AWARDING_FUND);
        if (!_isAccountOwner(awardingFund, msg.sender)) revert NotFundOwner();
        _;
    }

    function announceAward(AnnounceParams calldata p) external onlyFundOwner(p.awardingFund) {
        if (STORE.isSet(p.proposalSubject, SA_PROPOSAL_AWARDING_FUND)) {
            revert ProposalAlreadyAnnounced();
        }

        STORE.setBytes32(p.proposalSubject, SA_PROPOSAL_KIND, p.kind);
        STORE.setBytes32(p.proposalSubject, SA_PROPOSAL_STATUS, p.status);
        if (p.basedOnIntentId != bytes32(0)) {
            STORE.setBytes32(p.proposalSubject, SA_PROPOSAL_BASED_ON_INTENT, p.basedOnIntentId);
        }
        STORE.setBytes32(p.proposalSubject, SA_PROPOSAL_ROUND, p.round);
        STORE.setAddress(p.proposalSubject, SA_PROPOSAL_PROPOSER, p.proposer);
        STORE.setAddress(p.proposalSubject, SA_PROPOSAL_RECIPIENT, p.recipient);
        STORE.setUint(p.proposalSubject, SA_PROPOSAL_TOTAL_AWARDED, p.totalAwarded);
        STORE.setUint(p.proposalSubject, SA_PROPOSAL_AWARDED_AT, block.timestamp);
        if (p.bodyHash != bytes32(0)) {
            STORE.setBytes32(p.proposalSubject, SA_PROPOSAL_BODY_HASH, p.bodyHash);
        }
        STORE.setAddress(p.proposalSubject, SA_PROPOSAL_AWARDING_FUND, p.awardingFund);

        SHAPES.validateSubject(CLASS_PROPOSAL_PUBLIC_FACET, p.proposalSubject);

        emit ProposalAwardAnnounced(p.proposalSubject, p.round, p.totalAwarded);
    }

    function setStatus(bytes32 proposal, bytes32 newStatus) external onlyAwardingFundOwner(proposal) {
        STORE.setBytes32(proposal, SA_PROPOSAL_STATUS, newStatus);
        SHAPES.validateSubject(CLASS_PROPOSAL_PUBLIC_FACET, proposal);
        emit ProposalStatusChanged(proposal, newStatus);
    }

    // ─── Read helpers ──────────────────────────────────────────────

    function getStatus(bytes32 proposal) external view returns (bytes32) {
        return STORE.getBytes32(proposal, SA_PROPOSAL_STATUS);
    }

    function getKind(bytes32 proposal) external view returns (bytes32) {
        return STORE.getBytes32(proposal, SA_PROPOSAL_KIND);
    }

    function getBasedOnIntentId(bytes32 proposal) external view returns (bytes32) {
        return STORE.getBytes32(proposal, SA_PROPOSAL_BASED_ON_INTENT);
    }

    function getRound(bytes32 proposal) external view returns (bytes32) {
        return STORE.getBytes32(proposal, SA_PROPOSAL_ROUND);
    }

    function getProposer(bytes32 proposal) external view returns (address) {
        return STORE.getAddress(proposal, SA_PROPOSAL_PROPOSER);
    }

    function getRecipient(bytes32 proposal) external view returns (address) {
        return STORE.getAddress(proposal, SA_PROPOSAL_RECIPIENT);
    }

    function getTotalAwarded(bytes32 proposal) external view returns (uint256) {
        return STORE.getUint(proposal, SA_PROPOSAL_TOTAL_AWARDED);
    }

    function getAwardedAt(bytes32 proposal) external view returns (uint256) {
        return STORE.getUint(proposal, SA_PROPOSAL_AWARDED_AT);
    }

    function getBodyHash(bytes32 proposal) external view returns (bytes32) {
        return STORE.getBytes32(proposal, SA_PROPOSAL_BODY_HASH);
    }

    function getAwardingFund(bytes32 proposal) external view returns (address) {
        return STORE.getAddress(proposal, SA_PROPOSAL_AWARDING_FUND);
    }

    function isAnnounced(bytes32 proposal) external view returns (bool) {
        return STORE.isSet(proposal, SA_PROPOSAL_AWARDING_FUND);
    }
}
