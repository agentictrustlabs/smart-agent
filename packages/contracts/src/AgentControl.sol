// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentControl
 * @notice Governance layer for ERC-4337 agent smart accounts.
 *
 * Manages the owner set, quorum rules, and proposal-based approval
 * for sensitive actions. Separate from the trust graph — this is
 * the control plane for WHO can authorize actions on the agent.
 *
 * Follows multisig patterns from MetaMask Smart Accounts and Safe:
 * - Multiple owners per agent
 * - Configurable quorum threshold
 * - Bootstrap mode until minimum owners are installed
 * - Proposal/approval flow for sensitive operations
 */
contract AgentControl {
    enum ProposalStatus { PENDING, EXECUTED, CANCELLED }

    enum ActionClass {
        OWNER_CHANGE,
        RELATIONSHIP_APPROVE,
        TEMPLATE_ACTIVATE,
        DELEGATION_GRANT,
        EMERGENCY_PAUSE,
        METADATA_UPDATE
    }

    struct GovernanceConfig {
        uint256 minOwners;     // minimum owners before agent is active
        uint256 quorum;        // approvals needed to execute
        bool isBootstrap;      // true until minOwners met
    }

    struct Proposal {
        uint256 proposalId;
        address agent;
        ActionClass actionClass;
        bytes data;            // encoded action data
        address proposer;
        uint256 createdAt;
        ProposalStatus status;
        uint256 approvalCount;
    }

    // ─── Storage ────────────────────────────────────────────────────

    // agent → governance config
    mapping(address => GovernanceConfig) private _configs;

    // agent → owners
    mapping(address => address[]) private _owners;
    mapping(address => mapping(address => bool)) private _isOwner;

    // agent → proposals
    mapping(address => Proposal[]) private _proposals;

    // proposalId → voter → voted
    mapping(address => mapping(uint256 => mapping(address => bool))) private _votes;

    // agent → initialized
    mapping(address => bool) private _initialized;

    // ─── Events ─────────────────────────────────────────────────────

    event AgentInitialized(address indexed agent, address indexed creator, uint256 minOwners, uint256 quorum);
    event OwnerAdded(address indexed agent, address indexed owner);
    event OwnerRemoved(address indexed agent, address indexed owner);
    event BootstrapComplete(address indexed agent);
    event ProposalCreated(address indexed agent, uint256 indexed proposalId, ActionClass actionClass, address proposer);
    event ProposalApproved(address indexed agent, uint256 indexed proposalId, address indexed approver);
    event ProposalExecuted(address indexed agent, uint256 indexed proposalId);
    event QuorumChanged(address indexed agent, uint256 newQuorum);

    // ─── Errors ─────────────────────────────────────────────────────

    error AlreadyInitialized();
    error NotInitialized();
    error NotOwner();
    error AlreadyOwner();
    error NotAnOwner();
    error AlreadyVoted();
    error ProposalNotPending();
    error QuorumNotMet();
    error StillBootstrap();
    error InvalidQuorum();
    error CannotRemoveLastOwner();

    // ─── Initialize ─────────────────────────────────────────────────

    /**
     * @notice Initialize governance for an agent.
     *         Creator becomes the first owner.
     */
    function initializeAgent(
        address agent,
        uint256 minOwners,
        uint256 quorum
    ) external {
        if (_initialized[agent]) revert AlreadyInitialized();
        if (quorum == 0) revert InvalidQuorum();

        _initialized[agent] = true;
        _configs[agent] = GovernanceConfig({
            minOwners: minOwners,
            quorum: quorum,
            isBootstrap: minOwners > 1  // bootstrap if more than 1 owner required
        });

        _owners[agent].push(msg.sender);
        _isOwner[agent][msg.sender] = true;

        emit AgentInitialized(agent, msg.sender, minOwners, quorum);
        emit OwnerAdded(agent, msg.sender);

        // If minOwners = 1, bootstrap is immediately complete
        if (minOwners <= 1) {
            _configs[agent].isBootstrap = false;
            emit BootstrapComplete(agent);
        }
    }

    // ─── Owner Management ───────────────────────────────────────────

    function addOwner(address agent, address newOwner) external {
        _requireOwner(agent);
        if (_isOwner[agent][newOwner]) revert AlreadyOwner();

        _owners[agent].push(newOwner);
        _isOwner[agent][newOwner] = true;

        emit OwnerAdded(agent, newOwner);

        // Check if bootstrap complete
        GovernanceConfig storage config = _configs[agent];
        if (config.isBootstrap && _owners[agent].length >= config.minOwners) {
            config.isBootstrap = false;
            emit BootstrapComplete(agent);
        }
    }

    function removeOwner(address agent, address owner) external {
        _requireOwner(agent);
        if (!_isOwner[agent][owner]) revert NotAnOwner();
        if (_owners[agent].length <= 1) revert CannotRemoveLastOwner();

        _isOwner[agent][owner] = false;
        address[] storage owners = _owners[agent];
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        // Adjust quorum if needed
        GovernanceConfig storage config = _configs[agent];
        if (config.quorum > owners.length) {
            config.quorum = owners.length;
            emit QuorumChanged(agent, owners.length);
        }

        emit OwnerRemoved(agent, owner);
    }

    function setQuorum(address agent, uint256 newQuorum) external {
        _requireOwner(agent);
        if (newQuorum == 0 || newQuorum > _owners[agent].length) revert InvalidQuorum();

        _configs[agent].quorum = newQuorum;
        emit QuorumChanged(agent, newQuorum);
    }

    // ─── Proposals ──────────────────────────────────────────────────

    function createProposal(
        address agent,
        ActionClass actionClass,
        bytes calldata data
    ) external returns (uint256 proposalId) {
        _requireOwner(agent);
        _requireNotBootstrap(agent);

        proposalId = _proposals[agent].length;
        _proposals[agent].push(Proposal({
            proposalId: proposalId,
            agent: agent,
            actionClass: actionClass,
            data: data,
            proposer: msg.sender,
            createdAt: block.timestamp,
            status: ProposalStatus.PENDING,
            approvalCount: 1 // proposer auto-approves
        }));

        _votes[agent][proposalId][msg.sender] = true;

        emit ProposalCreated(agent, proposalId, actionClass, msg.sender);
        emit ProposalApproved(agent, proposalId, msg.sender);

        // Auto-execute if quorum of 1
        if (_configs[agent].quorum <= 1) {
            _proposals[agent][proposalId].status = ProposalStatus.EXECUTED;
            emit ProposalExecuted(agent, proposalId);
        }
    }

    function approveProposal(address agent, uint256 proposalId) external {
        _requireOwner(agent);
        if (proposalId >= _proposals[agent].length) revert ProposalNotPending();

        Proposal storage p = _proposals[agent][proposalId];
        if (p.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (_votes[agent][proposalId][msg.sender]) revert AlreadyVoted();

        _votes[agent][proposalId][msg.sender] = true;
        p.approvalCount++;

        emit ProposalApproved(agent, proposalId, msg.sender);

        // Check if quorum met
        if (p.approvalCount >= _configs[agent].quorum) {
            p.status = ProposalStatus.EXECUTED;
            emit ProposalExecuted(agent, proposalId);
        }
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getConfig(address agent) external view returns (GovernanceConfig memory) {
        if (!_initialized[agent]) revert NotInitialized();
        return _configs[agent];
    }

    function getOwners(address agent) external view returns (address[] memory) {
        return _owners[agent];
    }

    function isOwner(address agent, address account) external view returns (bool) {
        return _isOwner[agent][account];
    }

    function ownerCount(address agent) external view returns (uint256) {
        return _owners[agent].length;
    }

    function isInitialized(address agent) external view returns (bool) {
        return _initialized[agent];
    }

    function isGovernanceReady(address agent) external view returns (bool) {
        return _initialized[agent] && !_configs[agent].isBootstrap;
    }

    function getProposal(address agent, uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[agent][proposalId];
    }

    function proposalCount(address agent) external view returns (uint256) {
        return _proposals[agent].length;
    }

    function hasVoted(address agent, uint256 proposalId, address voter) external view returns (bool) {
        return _votes[agent][proposalId][voter];
    }

    /**
     * @notice Check if caller has authority to act on behalf of the agent.
     *         Used by other contracts to verify governance authority.
     */
    function canAct(address agent, address caller) external view returns (bool) {
        if (!_initialized[agent]) return false;
        if (_configs[agent].isBootstrap) return false;
        return _isOwner[agent][caller];
    }

    /**
     * @notice Check if a quorum-requiring action is approved.
     *         Returns true if the proposal exists, is executed, and matches the action class.
     */
    function isActionApproved(
        address agent,
        uint256 proposalId,
        ActionClass expectedClass
    ) external view returns (bool) {
        if (proposalId >= _proposals[agent].length) return false;
        Proposal storage p = _proposals[agent][proposalId];
        return p.status == ProposalStatus.EXECUTED && p.actionClass == expectedClass;
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _requireOwner(address agent) internal view {
        if (!_initialized[agent]) revert NotInitialized();
        if (!_isOwner[agent][msg.sender]) revert NotOwner();
    }

    function _requireNotBootstrap(address agent) internal view {
        if (_configs[agent].isBootstrap) revert StillBootstrap();
    }
}
