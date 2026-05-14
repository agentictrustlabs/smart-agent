// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

/**
 * @title ProposalRegistry
 * @notice Public-facet registry for awarded grant proposals. Body never
 *         anchors here per sa:GrantProposalAlwaysPrivateShape — the
 *         on-chain class for entries is sa:GrantProposalPublicFacet, a
 *         separate ontology class. Status enum intentionally excludes
 *         Submitted.
 *
 * Decoupled storage: this contract owns its attribute state via
 * AttributeStorage inheritance. Auth: caller must own the awarding fund's
 * AgentAccount.
 */
contract ProposalRegistry is AttributeStorage {
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
    // Spec 006 — preserve the originating NeedIntent string-form so the
    // commit-from-award call can populate `sa:commitmentNeedIntent`
    // without re-walking the proposal body. basedOnIntentId stays as the
    // bytes32 hash; this is the human/IRI string.
    bytes32 public constant SA_AWARD_NEED_INTENT         = keccak256("sa:awardNeedIntent");

    error NotFundOwner();
    error ProposalNotInitialized();
    error ProposalAlreadyAnnounced();

    event ProposalAwardAnnounced(bytes32 indexed proposalSubject, bytes32 round, uint256 totalAwarded);
    event ProposalStatusChanged(bytes32 indexed proposalSubject, bytes32 newStatus);

    struct AnnounceParams {
        bytes32 proposalSubject;
        bytes32 kind;
        bytes32 basedOnIntentId;     // bytes32 hash form (legacy + crypto linkage)
        bytes32 round;
        address proposer;
        address recipient;
        uint256 totalAwarded;
        bytes32 bodyHash;
        address awardingFund;
        bytes32 status;
        string  needIntentIdString;  // Spec 006 — IRI form for commitment.commit
    }

    constructor(address ontologyRegistry, address shapes) AttributeStorage(ontologyRegistry) {
        SHAPES = ShapeRegistry(shapes);
    }

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
        if (!this.isSet(proposal, SA_PROPOSAL_AWARDING_FUND)) revert ProposalNotInitialized();
        address awardingFund = this.getAddress(proposal, SA_PROPOSAL_AWARDING_FUND);
        if (!_isAccountOwner(awardingFund, msg.sender)) revert NotFundOwner();
        _;
    }

    function announceAward(AnnounceParams calldata p) external onlyFundOwner(p.awardingFund) {
        if (this.isSet(p.proposalSubject, SA_PROPOSAL_AWARDING_FUND)) {
            revert ProposalAlreadyAnnounced();
        }

        _setBytes32(p.proposalSubject, SA_PROPOSAL_KIND, p.kind);
        _setBytes32(p.proposalSubject, SA_PROPOSAL_STATUS, p.status);
        if (p.basedOnIntentId != bytes32(0)) {
            _setBytes32(p.proposalSubject, SA_PROPOSAL_BASED_ON_INTENT, p.basedOnIntentId);
        }
        if (bytes(p.needIntentIdString).length > 0) {
            _setString(p.proposalSubject, SA_AWARD_NEED_INTENT, p.needIntentIdString);
        }
        _setBytes32(p.proposalSubject, SA_PROPOSAL_ROUND, p.round);
        _setAddress(p.proposalSubject, SA_PROPOSAL_PROPOSER, p.proposer);
        _setAddress(p.proposalSubject, SA_PROPOSAL_RECIPIENT, p.recipient);
        _setUint(p.proposalSubject, SA_PROPOSAL_TOTAL_AWARDED, p.totalAwarded);
        _setUint(p.proposalSubject, SA_PROPOSAL_AWARDED_AT, block.timestamp);
        if (p.bodyHash != bytes32(0)) {
            _setBytes32(p.proposalSubject, SA_PROPOSAL_BODY_HASH, p.bodyHash);
        }
        _setAddress(p.proposalSubject, SA_PROPOSAL_AWARDING_FUND, p.awardingFund);

        SHAPES.validateSubject(CLASS_PROPOSAL_PUBLIC_FACET, p.proposalSubject, address(this));

        emit ProposalAwardAnnounced(p.proposalSubject, p.round, p.totalAwarded);
    }

    function setStatus(bytes32 proposal, bytes32 newStatus) external onlyAwardingFundOwner(proposal) {
        _setBytes32(proposal, SA_PROPOSAL_STATUS, newStatus);
        SHAPES.validateSubject(CLASS_PROPOSAL_PUBLIC_FACET, proposal, address(this));
        emit ProposalStatusChanged(proposal, newStatus);
    }

    // ─── Read helpers ──────────────────────────────────────────────

    function getStatus(bytes32 proposal) external view returns (bytes32) {
        return this.getBytes32(proposal, SA_PROPOSAL_STATUS);
    }
    function getKind(bytes32 proposal) external view returns (bytes32) {
        return this.getBytes32(proposal, SA_PROPOSAL_KIND);
    }
    function getBasedOnIntentId(bytes32 proposal) external view returns (bytes32) {
        return this.getBytes32(proposal, SA_PROPOSAL_BASED_ON_INTENT);
    }
    function getRound(bytes32 proposal) external view returns (bytes32) {
        return this.getBytes32(proposal, SA_PROPOSAL_ROUND);
    }
    function getProposer(bytes32 proposal) external view returns (address) {
        return this.getAddress(proposal, SA_PROPOSAL_PROPOSER);
    }
    function getRecipient(bytes32 proposal) external view returns (address) {
        return this.getAddress(proposal, SA_PROPOSAL_RECIPIENT);
    }
    function getTotalAwarded(bytes32 proposal) external view returns (uint256) {
        return this.getUint(proposal, SA_PROPOSAL_TOTAL_AWARDED);
    }
    function getAwardedAt(bytes32 proposal) external view returns (uint256) {
        return this.getUint(proposal, SA_PROPOSAL_AWARDED_AT);
    }
    function getBodyHash(bytes32 proposal) external view returns (bytes32) {
        return this.getBytes32(proposal, SA_PROPOSAL_BODY_HASH);
    }
    function getAwardingFund(bytes32 proposal) external view returns (address) {
        return this.getAddress(proposal, SA_PROPOSAL_AWARDING_FUND);
    }
    function isAnnounced(bytes32 proposal) external view returns (bool) {
        return this.isSet(proposal, SA_PROPOSAL_AWARDING_FUND);
    }
    function getAwardNeedIntent(bytes32 proposal) external view returns (string memory) {
        return this.getString(proposal, SA_AWARD_NEED_INTENT);
    }
}
