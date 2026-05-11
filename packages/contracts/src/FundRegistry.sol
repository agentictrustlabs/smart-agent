// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

/**
 * @title FundRegistry
 * @notice Fund body + Round body in this contract's own typed-attribute
 *         storage (inherited from AttributeStorage). Decoupled.
 *
 * Fund subject = fund's agent address (Fund is an OrganizationAgent).
 * Round subject = keccak256(abi.encodePacked("sa:round:", roundId)) — rounds
 * are not agents, so a synthetic id keeps them in the same store as their
 * owning fund.
 *
 * Auth: fund mutations require fund.AgentAccount.isOwner(msg.sender);
 * round mutations require the round's fund's AgentAccount.isOwner.
 */
contract FundRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_FUND  = keccak256("sa:Fund");
    bytes32 public constant CLASS_ROUND = keccak256("sa:Round");

    bytes32 public constant SA_FUND_ACCEPTED_KINDS  = keccak256("sa:fundAcceptedKinds");
    bytes32 public constant SA_FUND_OPEN_FOR_CALLS  = keccak256("sa:fundOpenForCalls");

    bytes32 public constant SA_ROUND_FUND_AGENT     = keccak256("sa:roundFundAgent");
    /** Optional: pool that operates this round. Lets the on-chain → GraphDB
     *  sync emit `sa:operatedByPool` so the UI can render the round↔pool
     *  link without relying on the fragile `fundAgent == pool.stewardshipAgent`
     *  inference. Legacy rounds opened before this field existed simply
     *  omit it. */
    bytes32 public constant SA_ROUND_POOL_AGENT     = keccak256("sa:roundPoolAgent");
    bytes32 public constant SA_ROUND_DEADLINE       = keccak256("sa:roundDeadline");
    bytes32 public constant SA_ROUND_DECISION_DATE  = keccak256("sa:roundDecisionDate");
    bytes32 public constant SA_ROUND_REPORTING_CADENCE = keccak256("sa:roundReportingCadence");
    bytes32 public constant SA_ROUND_REQUIRED_CREDENTIALS = keccak256("sa:roundRequiredCredentials");
    bytes32 public constant SA_ROUND_STATUS         = keccak256("sa:roundStatus");
    bytes32 public constant SA_ROUND_VISIBILITY     = keccak256("sa:roundVisibility");
    bytes32 public constant SA_ROUND_AWARDS_ROOT    = keccak256("sa:roundAwardsRoot");
    bytes32 public constant SA_ROUND_DISPUTE_UNTIL  = keccak256("sa:roundDisputeUntil");
    bytes32 public constant SA_ROUND_OPENED_AT      = keccak256("sa:roundOpenedAt");

    bytes32 public constant SA_ROUND_MANDATE                = keccak256("sa:roundMandate");
    bytes32 public constant SA_ROUND_MILESTONE_TEMPLATE     = keccak256("sa:roundMilestoneTemplate");
    bytes32 public constant SA_ROUND_VALIDATOR_REQUIREMENTS = keccak256("sa:roundValidatorRequirements");
    /** Original off-chain slug (e.g. "demo-trauma-care-q2"). Needed by the
     *  on-chain → GraphDB sync to construct urn:smart-agent:round:<slug>
     *  IRIs without consulting any off-chain index. */
    bytes32 public constant SA_ROUND_SLUG                   = keccak256("sa:roundSlug");

    /// Spec 004 R10 — DAO voting config moved on chain. Replaces the
    /// org-mcp `rounds` SQL table (now dropped). Set lazily via
    /// `setRoundVotingConfig`; the openRound flow continues to write the
    /// canonical body without requiring a voting config (default applies
    /// when unset: strategy = sa:VotingStewardQuorum, threshold = 2,
    /// no window).
    bytes32 public constant SA_ROUND_VOTING_STRATEGY         = keccak256("sa:roundVotingStrategy");
    bytes32 public constant SA_ROUND_VOTING_THRESHOLD        = keccak256("sa:roundVotingThreshold");
    bytes32 public constant SA_ROUND_VOTING_WINDOW_STARTS_AT = keccak256("sa:roundVotingWindowStartsAt");
    bytes32 public constant SA_ROUND_VOTING_WINDOW_ENDS_AT   = keccak256("sa:roundVotingWindowEndsAt");

    error NotFundOwner();
    error RoundNotInitialized();
    error MissingFundAgent();

    event FundRegistered(address indexed fundAgent, bytes32 subject);
    event RoundOpened(bytes32 indexed roundSubject, address indexed fundAgent, address indexed poolAgent);
    event RoundStatusChanged(bytes32 indexed roundSubject, bytes32 newStatus);
    event RoundAwardsRootSet(bytes32 indexed roundSubject, bytes32 awardsRoot, uint256 disputeUntil);

    struct OpenRoundParams {
        bytes32 roundSubject;
        address fundAgent;
        address poolAgent;             // 0x0 if not pool-backed
        uint256 deadline;
        uint256 decisionDate;
        bytes32 reportingCadence;
        bytes32[] requiredCredentials;
        bytes32 visibility;
        bytes32 initialStatus;
        string mandate;                // JSON; empty string means unset
        string milestoneTemplate;      // JSON
        string validatorRequirements;  // JSON
        string slug;                   // off-chain id; required for IRI derivation
    }

    constructor(address ontologyRegistry, address shapes) AttributeStorage(ontologyRegistry) {
        SHAPES = ShapeRegistry(shapes);
    }

    function _fundSubject(address fundAgent) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(fundAgent)));
    }

    function roundSubject(string calldata roundId) external pure returns (bytes32) {
        return keccak256(abi.encodePacked("sa:round:", roundId));
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

    modifier onlyRoundFundOwner(bytes32 round) {
        if (!this.isSet(round, SA_ROUND_FUND_AGENT)) revert RoundNotInitialized();
        address fundAgent = this.getAddress(round, SA_ROUND_FUND_AGENT);
        if (!_isAccountOwner(fundAgent, msg.sender)) revert NotFundOwner();
        _;
    }

    // ─── Fund ──────────────────────────────────────────────────────

    function registerFund(
        address fundAgent,
        bytes32[] calldata acceptedKinds,
        bool openForCalls
    ) external onlyFundOwner(fundAgent) {
        bytes32 s = _fundSubject(fundAgent);
        _setBytes32Arr(s, SA_FUND_ACCEPTED_KINDS, acceptedKinds);
        _setBool(s, SA_FUND_OPEN_FOR_CALLS, openForCalls);
        emit FundRegistered(fundAgent, s);
    }

    function setFundOpenForCalls(address fundAgent, bool openForCalls) external onlyFundOwner(fundAgent) {
        _setBool(_fundSubject(fundAgent), SA_FUND_OPEN_FOR_CALLS, openForCalls);
    }

    function setFundAcceptedKinds(address fundAgent, bytes32[] calldata kinds) external onlyFundOwner(fundAgent) {
        _setBytes32Arr(_fundSubject(fundAgent), SA_FUND_ACCEPTED_KINDS, kinds);
    }

    // ─── Round ─────────────────────────────────────────────────────

    function openRound(OpenRoundParams calldata p) external onlyFundOwner(p.fundAgent) {
        if (p.fundAgent == address(0)) revert MissingFundAgent();

        _setAddress(p.roundSubject, SA_ROUND_FUND_AGENT, p.fundAgent);
        if (p.poolAgent != address(0)) {
            _setAddress(p.roundSubject, SA_ROUND_POOL_AGENT, p.poolAgent);
        }
        _setUint(p.roundSubject, SA_ROUND_DEADLINE, p.deadline);
        _setUint(p.roundSubject, SA_ROUND_DECISION_DATE, p.decisionDate);
        _setBytes32(p.roundSubject, SA_ROUND_REPORTING_CADENCE, p.reportingCadence);
        if (p.requiredCredentials.length > 0) {
            _setBytes32Arr(p.roundSubject, SA_ROUND_REQUIRED_CREDENTIALS, p.requiredCredentials);
        }
        _setBytes32(p.roundSubject, SA_ROUND_VISIBILITY, p.visibility);
        _setBytes32(p.roundSubject, SA_ROUND_STATUS, p.initialStatus);
        _setUint(p.roundSubject, SA_ROUND_OPENED_AT, block.timestamp);
        if (bytes(p.mandate).length > 0) {
            _setString(p.roundSubject, SA_ROUND_MANDATE, p.mandate);
        }
        if (bytes(p.milestoneTemplate).length > 0) {
            _setString(p.roundSubject, SA_ROUND_MILESTONE_TEMPLATE, p.milestoneTemplate);
        }
        if (bytes(p.validatorRequirements).length > 0) {
            _setString(p.roundSubject, SA_ROUND_VALIDATOR_REQUIREMENTS, p.validatorRequirements);
        }
        if (bytes(p.slug).length > 0) {
            _setString(p.roundSubject, SA_ROUND_SLUG, p.slug);
        }

        SHAPES.validateSubject(CLASS_ROUND, p.roundSubject, address(this));

        emit RoundOpened(p.roundSubject, p.fundAgent, p.poolAgent);
    }

    /** Retro-assign or change the pool that operates a round. Useful for
     *  legacy rounds that predate the `poolAgent` field. */
    function setRoundPoolAgent(bytes32 round, address poolAgent) external onlyRoundFundOwner(round) {
        _setAddress(round, SA_ROUND_POOL_AGENT, poolAgent);
    }

    function setRoundStatus(bytes32 round, bytes32 newStatus) external onlyRoundFundOwner(round) {
        _setBytes32(round, SA_ROUND_STATUS, newStatus);
        SHAPES.validateSubject(CLASS_ROUND, round, address(this));
        emit RoundStatusChanged(round, newStatus);
    }

    function setRoundAwardsRoot(
        bytes32 round,
        bytes32 awardsRoot,
        uint256 disputeUntil
    ) external onlyRoundFundOwner(round) {
        _setBytes32(round, SA_ROUND_AWARDS_ROOT, awardsRoot);
        _setUint(round, SA_ROUND_DISPUTE_UNTIL, disputeUntil);
        emit RoundAwardsRootSet(round, awardsRoot, disputeUntil);
    }

    function setRoundMandate(bytes32 round, string calldata mandate) external onlyRoundFundOwner(round) {
        _setString(round, SA_ROUND_MANDATE, mandate);
    }

    function setRoundMilestoneTemplate(bytes32 round, string calldata template) external onlyRoundFundOwner(round) {
        _setString(round, SA_ROUND_MILESTONE_TEMPLATE, template);
    }

    function setRoundValidatorRequirements(bytes32 round, string calldata requirements) external onlyRoundFundOwner(round) {
        _setString(round, SA_ROUND_VALIDATOR_REQUIREMENTS, requirements);
    }

    /// Spec 004 R10 — DAO voting config. `strategy` is a keccak256 concept
    /// hash (e.g. keccak256("sa:VotingStewardQuorum")). `windowStartsAt` and
    /// `windowEndsAt` are unix seconds; pass 0 to mean "no window".
    function setRoundVotingConfig(
        bytes32 round,
        bytes32 strategy,
        uint256 threshold,
        uint256 windowStartsAt,
        uint256 windowEndsAt
    ) external onlyRoundFundOwner(round) {
        _setBytes32(round, SA_ROUND_VOTING_STRATEGY, strategy);
        _setUint(round, SA_ROUND_VOTING_THRESHOLD, threshold);
        if (windowStartsAt > 0) _setUint(round, SA_ROUND_VOTING_WINDOW_STARTS_AT, windowStartsAt);
        if (windowEndsAt > 0)   _setUint(round, SA_ROUND_VOTING_WINDOW_ENDS_AT,   windowEndsAt);
    }

    // ─── Read helpers ──────────────────────────────────────────────

    function getFundAcceptedKinds(address fundAgent) external view returns (bytes32[] memory) {
        return this.getBytes32Arr(_fundSubject(fundAgent), SA_FUND_ACCEPTED_KINDS);
    }
    function isFundOpenForCalls(address fundAgent) external view returns (bool) {
        return this.getBool(_fundSubject(fundAgent), SA_FUND_OPEN_FOR_CALLS);
    }
    function getRoundFundAgent(bytes32 round) external view returns (address) {
        return this.getAddress(round, SA_ROUND_FUND_AGENT);
    }
    function getRoundPoolAgent(bytes32 round) external view returns (address) {
        return this.getAddress(round, SA_ROUND_POOL_AGENT);
    }
    function getRoundStatus(bytes32 round) external view returns (bytes32) {
        return this.getBytes32(round, SA_ROUND_STATUS);
    }
    function getRoundDeadline(bytes32 round) external view returns (uint256) {
        return this.getUint(round, SA_ROUND_DEADLINE);
    }
    function getRoundDecisionDate(bytes32 round) external view returns (uint256) {
        return this.getUint(round, SA_ROUND_DECISION_DATE);
    }
    function getRoundVisibility(bytes32 round) external view returns (bytes32) {
        return this.getBytes32(round, SA_ROUND_VISIBILITY);
    }
    function getRoundReportingCadence(bytes32 round) external view returns (bytes32) {
        return this.getBytes32(round, SA_ROUND_REPORTING_CADENCE);
    }
    function getRoundRequiredCredentials(bytes32 round) external view returns (bytes32[] memory) {
        return this.getBytes32Arr(round, SA_ROUND_REQUIRED_CREDENTIALS);
    }
    function getRoundAwardsRoot(bytes32 round) external view returns (bytes32) {
        return this.getBytes32(round, SA_ROUND_AWARDS_ROOT);
    }
    function getRoundDisputeUntil(bytes32 round) external view returns (uint256) {
        return this.getUint(round, SA_ROUND_DISPUTE_UNTIL);
    }
    function getRoundOpenedAt(bytes32 round) external view returns (uint256) {
        return this.getUint(round, SA_ROUND_OPENED_AT);
    }
    function getRoundMandate(bytes32 round) external view returns (string memory) {
        return this.getString(round, SA_ROUND_MANDATE);
    }
    function getRoundMilestoneTemplate(bytes32 round) external view returns (string memory) {
        return this.getString(round, SA_ROUND_MILESTONE_TEMPLATE);
    }

    /// Spec 004 R10 — read voting config. Returns zero values when unset
    /// (callers default: strategy = sa:VotingStewardQuorum, threshold = 2,
    /// no window). The org-mcp `vote:tally_for_round` tool falls back to
    /// these defaults when any field is zero.
    function getRoundVotingConfig(bytes32 round) external view returns (
        bytes32 strategy,
        uint256 threshold,
        uint256 windowStartsAt,
        uint256 windowEndsAt
    ) {
        strategy = this.getBytes32(round, SA_ROUND_VOTING_STRATEGY);
        threshold = this.getUint(round, SA_ROUND_VOTING_THRESHOLD);
        windowStartsAt = this.getUint(round, SA_ROUND_VOTING_WINDOW_STARTS_AT);
        windowEndsAt = this.getUint(round, SA_ROUND_VOTING_WINDOW_ENDS_AT);
    }
    function getRoundValidatorRequirements(bytes32 round) external view returns (string memory) {
        return this.getString(round, SA_ROUND_VALIDATOR_REQUIREMENTS);
    }
    function getRoundSlug(bytes32 round) external view returns (string memory) {
        return this.getString(round, SA_ROUND_SLUG);
    }
}
