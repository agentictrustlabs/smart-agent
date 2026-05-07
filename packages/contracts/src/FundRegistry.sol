// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyAttributeStore.sol";
import "./ShapeRegistry.sol";

/**
 * @title FundRegistry
 * @notice Phase 0.4 — Fund body + Round body via the shared attribute store.
 *
 * A Fund is an OrganizationAgent (sa:Fund subClassOf sa:Pool subClassOf
 * sa:OrganizationAgent). Its subject is the fund's agent address.
 *
 * A Round is NOT an agent. Its subject is a synthetic id derived from a
 * caller-supplied string id:
 *     subject = keccak256(abi.encodePacked("sa:round:", roundId))
 *
 * The same registry contract handles both because round ownership chains
 * back to its fund: every round write requires the round's sa:roundFundAgent
 * to be set AND msg.sender to be an owner of that fund's smart account.
 *
 * Auth: fund mutations require fund.AgentAccount.isOwner(msg.sender).
 *       Round mutations require the round's fund's AgentAccount.isOwner
 *       (derived from sa:roundFundAgent — must be set by openRound first).
 */
contract FundRegistry {
    OntologyAttributeStore public immutable STORE;
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_FUND  = keccak256("sa:Fund");
    bytes32 public constant CLASS_ROUND = keccak256("sa:Round");

    bytes32 public constant SA_FUND_ACCEPTED_KINDS  = keccak256("sa:fundAcceptedKinds");
    bytes32 public constant SA_FUND_OPEN_FOR_CALLS  = keccak256("sa:fundOpenForCalls");

    bytes32 public constant SA_ROUND_FUND_AGENT     = keccak256("sa:roundFundAgent");
    bytes32 public constant SA_ROUND_DEADLINE       = keccak256("sa:roundDeadline");
    bytes32 public constant SA_ROUND_DECISION_DATE  = keccak256("sa:roundDecisionDate");
    bytes32 public constant SA_ROUND_REPORTING_CADENCE = keccak256("sa:roundReportingCadence");
    bytes32 public constant SA_ROUND_REQUIRED_CREDENTIALS = keccak256("sa:roundRequiredCredentials");
    bytes32 public constant SA_ROUND_STATUS         = keccak256("sa:roundStatus");
    bytes32 public constant SA_ROUND_VISIBILITY     = keccak256("sa:roundVisibility");
    bytes32 public constant SA_ROUND_AWARDS_ROOT    = keccak256("sa:roundAwardsRoot");
    bytes32 public constant SA_ROUND_DISPUTE_UNTIL  = keccak256("sa:roundDisputeUntil");
    bytes32 public constant SA_ROUND_OPENED_AT      = keccak256("sa:roundOpenedAt");

    error NotFundOwner();
    error RoundNotInitialized();
    error MissingFundAgent();

    event FundRegistered(address indexed fundAgent, bytes32 subject);
    event RoundOpened(bytes32 indexed roundSubject, address indexed fundAgent);
    event RoundStatusChanged(bytes32 indexed roundSubject, bytes32 newStatus);
    event RoundAwardsRootSet(bytes32 indexed roundSubject, bytes32 awardsRoot, uint256 disputeUntil);

    /// @dev Bag of args for openRound — keeps the public ABI legible.
    struct OpenRoundParams {
        bytes32 roundSubject;
        address fundAgent;
        uint256 deadline;
        uint256 decisionDate;
        bytes32 reportingCadence;
        bytes32[] requiredCredentials;
        bytes32 visibility;
        bytes32 initialStatus;
    }

    constructor(address store, address shapes) {
        STORE = OntologyAttributeStore(store);
        SHAPES = ShapeRegistry(shapes);
    }

    function _fundSubject(address fundAgent) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(fundAgent)));
    }

    /// @notice Compute the canonical round subject id for an off-chain string id.
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
        if (!STORE.isSet(round, SA_ROUND_FUND_AGENT)) revert RoundNotInitialized();
        address fundAgent = STORE.getAddress(round, SA_ROUND_FUND_AGENT);
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
        STORE.setBytes32Arr(s, SA_FUND_ACCEPTED_KINDS, acceptedKinds);
        STORE.setBool(s, SA_FUND_OPEN_FOR_CALLS, openForCalls);
        emit FundRegistered(fundAgent, s);
    }

    function setFundOpenForCalls(address fundAgent, bool openForCalls) external onlyFundOwner(fundAgent) {
        STORE.setBool(_fundSubject(fundAgent), SA_FUND_OPEN_FOR_CALLS, openForCalls);
    }

    function setFundAcceptedKinds(address fundAgent, bytes32[] calldata kinds) external onlyFundOwner(fundAgent) {
        STORE.setBytes32Arr(_fundSubject(fundAgent), SA_FUND_ACCEPTED_KINDS, kinds);
    }

    // ─── Round ─────────────────────────────────────────────────────

    function openRound(OpenRoundParams calldata p) external onlyFundOwner(p.fundAgent) {
        if (p.fundAgent == address(0)) revert MissingFundAgent();

        STORE.setAddress(p.roundSubject, SA_ROUND_FUND_AGENT, p.fundAgent);
        STORE.setUint(p.roundSubject, SA_ROUND_DEADLINE, p.deadline);
        STORE.setUint(p.roundSubject, SA_ROUND_DECISION_DATE, p.decisionDate);
        STORE.setBytes32(p.roundSubject, SA_ROUND_REPORTING_CADENCE, p.reportingCadence);
        if (p.requiredCredentials.length > 0) {
            STORE.setBytes32Arr(p.roundSubject, SA_ROUND_REQUIRED_CREDENTIALS, p.requiredCredentials);
        }
        STORE.setBytes32(p.roundSubject, SA_ROUND_VISIBILITY, p.visibility);
        STORE.setBytes32(p.roundSubject, SA_ROUND_STATUS, p.initialStatus);
        STORE.setUint(p.roundSubject, SA_ROUND_OPENED_AT, block.timestamp);

        SHAPES.validateSubject(CLASS_ROUND, p.roundSubject);

        emit RoundOpened(p.roundSubject, p.fundAgent);
    }

    function setRoundStatus(bytes32 round, bytes32 newStatus) external onlyRoundFundOwner(round) {
        STORE.setBytes32(round, SA_ROUND_STATUS, newStatus);
        // Re-validate to ensure the new status passes the enum constraint
        SHAPES.validateSubject(CLASS_ROUND, round);
        emit RoundStatusChanged(round, newStatus);
    }

    function setRoundAwardsRoot(
        bytes32 round,
        bytes32 awardsRoot,
        uint256 disputeUntil
    ) external onlyRoundFundOwner(round) {
        STORE.setBytes32(round, SA_ROUND_AWARDS_ROOT, awardsRoot);
        STORE.setUint(round, SA_ROUND_DISPUTE_UNTIL, disputeUntil);
        emit RoundAwardsRootSet(round, awardsRoot, disputeUntil);
    }

    // ─── Read helpers ──────────────────────────────────────────────

    function getFundAcceptedKinds(address fundAgent) external view returns (bytes32[] memory) {
        return STORE.getBytes32Arr(_fundSubject(fundAgent), SA_FUND_ACCEPTED_KINDS);
    }

    function isFundOpenForCalls(address fundAgent) external view returns (bool) {
        return STORE.getBool(_fundSubject(fundAgent), SA_FUND_OPEN_FOR_CALLS);
    }

    function getRoundFundAgent(bytes32 round) external view returns (address) {
        return STORE.getAddress(round, SA_ROUND_FUND_AGENT);
    }

    function getRoundStatus(bytes32 round) external view returns (bytes32) {
        return STORE.getBytes32(round, SA_ROUND_STATUS);
    }

    function getRoundDeadline(bytes32 round) external view returns (uint256) {
        return STORE.getUint(round, SA_ROUND_DEADLINE);
    }

    function getRoundDecisionDate(bytes32 round) external view returns (uint256) {
        return STORE.getUint(round, SA_ROUND_DECISION_DATE);
    }

    function getRoundVisibility(bytes32 round) external view returns (bytes32) {
        return STORE.getBytes32(round, SA_ROUND_VISIBILITY);
    }

    function getRoundReportingCadence(bytes32 round) external view returns (bytes32) {
        return STORE.getBytes32(round, SA_ROUND_REPORTING_CADENCE);
    }

    function getRoundRequiredCredentials(bytes32 round) external view returns (bytes32[] memory) {
        return STORE.getBytes32Arr(round, SA_ROUND_REQUIRED_CREDENTIALS);
    }

    function getRoundAwardsRoot(bytes32 round) external view returns (bytes32) {
        return STORE.getBytes32(round, SA_ROUND_AWARDS_ROOT);
    }

    function getRoundDisputeUntil(bytes32 round) external view returns (uint256) {
        return STORE.getUint(round, SA_ROUND_DISPUTE_UNTIL);
    }

    function getRoundOpenedAt(bytes32 round) external view returns (uint256) {
        return STORE.getUint(round, SA_ROUND_OPENED_AT);
    }
}
