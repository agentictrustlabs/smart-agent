// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IAttributeAuth.sol";

/**
 * @title AttributeAuth
 * @notice Default IAttributeAuth implementation for OntologyAttributeStore.
 *
 * Authorization layers, evaluated in order; first allow returns true:
 *
 *   1. Trusted writers — contracts the governor has whitelisted as
 *      registry-class authorities (PoolRegistry, FundRegistry, ProposalRegistry,
 *      AgentAccountResolver shim). They can write any (subject, predicate).
 *
 *   2. Per-(subject, predicate) explicit grants — fine-grained delegation
 *      e.g., the awarding Pool's address granted to mutate sa:proposalStatus
 *      on a specific proposal subject.
 *
 *   3. Per-subject explicit grants — coarse-grained; e.g., a Round's owning
 *      Fund granted to mutate any predicate on that round subject.
 *
 *   4. Agent-owner fallback — if subject decodes as a uint160 (i.e., the
 *      subject id matches an agent's smart-account address pattern), call
 *      AgentAccount(addr).isOwner(actor). Used for agent subjects and for
 *      pool-as-agent / fund-as-agent subjects in Phases 0.3 / 0.4.
 *
 * Anything else returns false.
 */
contract AttributeAuth is IAttributeAuth {
    address public governor;

    mapping(address => bool)                                       public trustedWriter;
    mapping(bytes32 => mapping(address => bool))                   public subjectGrant;
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) public predicateGrant;

    event GovernorTransferred(address indexed previousGovernor, address indexed newGovernor);
    event TrustedWriterSet(address indexed writer, bool allowed);
    event SubjectGrantSet(bytes32 indexed subject, address indexed actor, bool allowed);
    event PredicateGrantSet(bytes32 indexed subject, bytes32 indexed predicate, address indexed actor, bool allowed);

    error NotGovernor();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_) {
        governor = governor_;
    }

    function transferGovernor(address newGovernor) external onlyGovernor {
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    function setTrustedWriter(address writer, bool allowed) external onlyGovernor {
        trustedWriter[writer] = allowed;
        emit TrustedWriterSet(writer, allowed);
    }

    function setSubjectGrant(bytes32 subject, address actor, bool allowed) external onlyGovernor {
        subjectGrant[subject][actor] = allowed;
        emit SubjectGrantSet(subject, actor, allowed);
    }

    function setPredicateGrant(bytes32 subject, bytes32 predicate, address actor, bool allowed) external onlyGovernor {
        predicateGrant[subject][predicate][actor] = allowed;
        emit PredicateGrantSet(subject, predicate, actor, allowed);
    }

    function canWrite(bytes32 subject, bytes32 predicate, address actor) external view returns (bool) {
        if (trustedWriter[actor]) return true;
        if (predicateGrant[subject][predicate][actor]) return true;
        if (subjectGrant[subject][actor]) return true;
        return _isAgentOwner(subject, actor);
    }

    /// @dev If the subject id pattern is a left-padded address, attempt to call
    ///      AgentAccount.isOwner(actor) on it. Returns false on any failure.
    function _isAgentOwner(bytes32 subject, address actor) internal view returns (bool) {
        // Left-padded address pattern: upper 96 bits zero
        if (uint256(subject) >> 160 != 0) return false;
        address candidate = address(uint160(uint256(subject)));
        if (candidate == address(0)) return false;
        if (candidate.code.length == 0) return false;

        (bool ok, bytes memory data) = candidate.staticcall(
            abi.encodeWithSignature("isOwner(address)", actor)
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }
}
