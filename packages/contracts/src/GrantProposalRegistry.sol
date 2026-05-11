// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

interface IRoundFundLookup2 {
    function getRoundFundAgent(bytes32 round) external view returns (address);
    function getRoundPoolAgent(bytes32 round) external view returns (address);
}

/**
 * @title GrantProposalRegistry
 * @notice On-chain authoritative store for full grant-proposal bodies
 *         (the "submission" surface; the sibling `ProposalRegistry`
 *         covers the post-award public-facet shape).
 *
 * Each row is **nullifier-keyed** — no submitter identity is stored on
 * chain. The nullifier comes from an AnonCreds
 * `ProposalSubmitterCredential` granted by the pool steward to the holder;
 * it is stable for the lifetime of that credential and unique per
 * (credential, round). The same holder edits / withdraws / clones by
 * re-presenting the same credential — the verifier re-derives the same
 * nullifier and matches it against the stored row.
 *
 * Subject = keccak256("sa:grantProposal:", roundSubject, nullifier).
 *
 * Auth: the round's fund-owner AgentAccount is the writer (delegated, in
 * practice, to the org-mcp gateway via session delegation). org-mcp
 * verifies the AnonCreds presentation off-chain before submitting; the
 * chain trusts the gateway as the publisher.
 *
 * Privacy: bodies are plaintext on chain. Anonymity is provided by the
 * nullifier replacing identity, NOT by encrypting the body. If a future
 * deployment needs encrypted bodies, layer that at the publisher.
 */
contract GrantProposalRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;
    IRoundFundLookup2 public immutable FUND_REGISTRY;

    bytes32 public constant CLASS_GRANT_PROPOSAL = keccak256("sa:GrantProposal");

    bytes32 public constant SA_GP_ROUND         = keccak256("sa:gpRound");
    bytes32 public constant SA_GP_NULLIFIER     = keccak256("sa:gpNullifier");
    bytes32 public constant SA_GP_DISPLAY_NAME  = keccak256("sa:gpDisplayName");
    bytes32 public constant SA_GP_BASED_ON      = keccak256("sa:gpBasedOn");
    bytes32 public constant SA_GP_BUDGET        = keccak256("sa:gpBudget");       // JSON
    bytes32 public constant SA_GP_PLAN          = keccak256("sa:gpPlan");         // JSON
    bytes32 public constant SA_GP_MILESTONES    = keccak256("sa:gpMilestones");   // JSON
    bytes32 public constant SA_GP_OUTCOMES      = keccak256("sa:gpOutcomes");     // JSON
    bytes32 public constant SA_GP_REPORTING     = keccak256("sa:gpReporting");    // JSON
    bytes32 public constant SA_GP_ORG_BG        = keccak256("sa:gpOrgBackground");// JSON
    bytes32 public constant SA_GP_STATUS        = keccak256("sa:gpStatus");       // concept hash
    bytes32 public constant SA_GP_SUBMITTED_AT  = keccak256("sa:gpSubmittedAt");
    bytes32 public constant SA_GP_LAST_EDITED   = keccak256("sa:gpLastEdited");
    bytes32 public constant SA_GP_VERSION       = keccak256("sa:gpVersion");
    bytes32 public constant SA_GP_WITHDRAWN_AT  = keccak256("sa:gpWithdrawnAt");
    bytes32 public constant SA_GP_CLONED_FROM   = keccak256("sa:gpClonedFrom");
    bytes32 public constant SA_GP_BASIS         = keccak256("sa:gpBasis");        // JSON

    error NotRoundOperator();
    error GrantProposalNotFound();

    event GrantProposalSubmitted(bytes32 indexed gpSubject, bytes32 indexed roundSubject, bytes32 indexed nullifier);
    event GrantProposalEdited(bytes32 indexed gpSubject, uint256 newVersion);
    event GrantProposalWithdrawn(bytes32 indexed gpSubject);
    event GrantProposalStatusChanged(bytes32 indexed gpSubject, bytes32 newStatus);

    struct SubmitParams {
        bytes32 roundSubject;
        bytes32 nullifier;
        string  displayName;
        string  basedOnIntentId;
        string  budgetJson;
        string  planJson;
        string  milestonesJson;
        string  outcomesJson;
        string  reportingJson;
        string  orgBackgroundJson;
        string  basisJson;
    }

    struct EditPatch {
        bool   editBudget;        string newBudgetJson;
        bool   editPlan;          string newPlanJson;
        bool   editMilestones;    string newMilestonesJson;
        bool   editOutcomes;      string newOutcomesJson;
        bool   editReporting;     string newReportingJson;
        bool   editOrgBackground; string newOrgBackgroundJson;
    }

    constructor(address ontologyRegistry, address shapes, address fundRegistry)
        AttributeStorage(ontologyRegistry)
    {
        SHAPES = ShapeRegistry(shapes);
        FUND_REGISTRY = IRoundFundLookup2(fundRegistry);
    }

    function _gpSubject(bytes32 roundSubject, bytes32 nullifier) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("sa:grantProposal:", roundSubject, nullifier));
    }

    function gpSubject(bytes32 roundSubject, bytes32 nullifier) external pure returns (bytes32) {
        return _gpSubject(roundSubject, nullifier);
    }

    function _isAccountOwner(address account, address actor) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", actor)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    modifier onlyRoundOperator(bytes32 roundSubject) {
        address fundAgent = FUND_REGISTRY.getRoundFundAgent(roundSubject);
        if (fundAgent == address(0) || !_isAccountOwner(fundAgent, msg.sender)) {
            revert NotRoundOperator();
        }
        _;
    }

    function submit(SubmitParams calldata p) external onlyRoundOperator(p.roundSubject) {
        bytes32 subj = _gpSubject(p.roundSubject, p.nullifier);

        _setBytes32(subj, SA_GP_ROUND, p.roundSubject);
        _setBytes32(subj, SA_GP_NULLIFIER, p.nullifier);
        _setString(subj, SA_GP_DISPLAY_NAME, p.displayName);
        _setString(subj, SA_GP_BASED_ON, p.basedOnIntentId);
        _setString(subj, SA_GP_BUDGET, p.budgetJson);
        _setString(subj, SA_GP_PLAN, p.planJson);
        _setString(subj, SA_GP_MILESTONES, p.milestonesJson);
        _setString(subj, SA_GP_OUTCOMES, p.outcomesJson);
        _setString(subj, SA_GP_REPORTING, p.reportingJson);
        _setString(subj, SA_GP_ORG_BG, p.orgBackgroundJson);
        _setBytes32(subj, SA_GP_STATUS, keccak256("sa:GrantProposalSubmitted"));
        _setUint(subj, SA_GP_SUBMITTED_AT, block.timestamp);
        _setUint(subj, SA_GP_LAST_EDITED, block.timestamp);
        _setUint(subj, SA_GP_VERSION, 0);
        if (bytes(p.basisJson).length > 0) {
            _setString(subj, SA_GP_BASIS, p.basisJson);
        }
        SHAPES.validateSubject(CLASS_GRANT_PROPOSAL, subj, address(this));
        emit GrantProposalSubmitted(subj, p.roundSubject, p.nullifier);
    }

    function edit(bytes32 gp, EditPatch calldata patch) external {
        bytes32 roundSubj = this.getBytes32(gp, SA_GP_ROUND);
        if (roundSubj == bytes32(0)) revert GrantProposalNotFound();
        address fundAgent = FUND_REGISTRY.getRoundFundAgent(roundSubj);
        if (!_isAccountOwner(fundAgent, msg.sender)) revert NotRoundOperator();

        if (patch.editBudget)        _setString(gp, SA_GP_BUDGET, patch.newBudgetJson);
        if (patch.editPlan)          _setString(gp, SA_GP_PLAN, patch.newPlanJson);
        if (patch.editMilestones)    _setString(gp, SA_GP_MILESTONES, patch.newMilestonesJson);
        if (patch.editOutcomes)      _setString(gp, SA_GP_OUTCOMES, patch.newOutcomesJson);
        if (patch.editReporting)     _setString(gp, SA_GP_REPORTING, patch.newReportingJson);
        if (patch.editOrgBackground) _setString(gp, SA_GP_ORG_BG, patch.newOrgBackgroundJson);

        uint256 nextVer = this.getUint(gp, SA_GP_VERSION) + 1;
        _setUint(gp, SA_GP_VERSION, nextVer);
        _setUint(gp, SA_GP_LAST_EDITED, block.timestamp);
        emit GrantProposalEdited(gp, nextVer);
    }

    function withdraw(bytes32 gp) external {
        bytes32 roundSubj = this.getBytes32(gp, SA_GP_ROUND);
        if (roundSubj == bytes32(0)) revert GrantProposalNotFound();
        address fundAgent = FUND_REGISTRY.getRoundFundAgent(roundSubj);
        if (!_isAccountOwner(fundAgent, msg.sender)) revert NotRoundOperator();
        _setBytes32(gp, SA_GP_STATUS, keccak256("sa:GrantProposalWithdrawn"));
        _setUint(gp, SA_GP_WITHDRAWN_AT, block.timestamp);
        emit GrantProposalWithdrawn(gp);
    }

    function setStatus(bytes32 gp, bytes32 newStatus) external {
        bytes32 roundSubj = this.getBytes32(gp, SA_GP_ROUND);
        if (roundSubj == bytes32(0)) revert GrantProposalNotFound();
        address fundAgent = FUND_REGISTRY.getRoundFundAgent(roundSubj);
        if (!_isAccountOwner(fundAgent, msg.sender)) revert NotRoundOperator();
        _setBytes32(gp, SA_GP_STATUS, newStatus);
        emit GrantProposalStatusChanged(gp, newStatus);
    }
}
