// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentDisputeRecord
 * @notice Adverse signals and dispute records for agents.
 *
 * Disputes are negative trust evidence: flags, sanctions, suspensions,
 * revocations, and blacklists. These are first-class citizens in the
 * trust graph — trust needs negative evidence too.
 */
contract AgentDisputeRecord {
    enum DisputeType {
        NONE,
        FLAG,           // soft warning
        DISPUTE,        // formal dispute
        SANCTION,       // regulatory/governance action
        SUSPENSION,     // temporary removal
        REVOCATION,     // permanent removal
        BLACKLIST       // banned
    }

    enum DisputeStatus {
        OPEN,
        UNDER_REVIEW,
        RESOLVED,
        DISMISSED,
        UPHELD
    }

    struct Dispute {
        uint256 disputeId;
        address subject;        // agent the dispute is about
        address filedBy;        // who filed the dispute
        DisputeType disputeType;
        DisputeStatus status;
        string reason;
        string evidenceURI;
        address resolvedBy;
        string resolutionNote;
        uint256 filedAt;
        uint256 resolvedAt;
    }

    Dispute[] private _disputes;
    mapping(address => uint256[]) private _bySubject;
    mapping(address => uint256[]) private _byFiler;

    event DisputeFiled(
        uint256 indexed disputeId,
        address indexed subject,
        address indexed filedBy,
        DisputeType disputeType
    );

    event DisputeResolved(
        uint256 indexed disputeId,
        DisputeStatus status,
        address indexed resolvedBy
    );

    error DisputeNotFound();
    error NotAuthorized();
    error AlreadyResolved();

    function fileDispute(
        address subject,
        DisputeType disputeType,
        string calldata reason,
        string calldata evidenceURI
    ) external returns (uint256 disputeId) {
        disputeId = _disputes.length;
        _disputes.push(Dispute({
            disputeId: disputeId,
            subject: subject,
            filedBy: msg.sender,
            disputeType: disputeType,
            status: DisputeStatus.OPEN,
            reason: reason,
            evidenceURI: evidenceURI,
            resolvedBy: address(0),
            resolutionNote: "",
            filedAt: block.timestamp,
            resolvedAt: 0
        }));

        _bySubject[subject].push(disputeId);
        _byFiler[msg.sender].push(disputeId);

        emit DisputeFiled(disputeId, subject, msg.sender, disputeType);
    }

    function resolveDispute(
        uint256 disputeId,
        DisputeStatus newStatus,
        string calldata resolutionNote
    ) external {
        if (disputeId >= _disputes.length) revert DisputeNotFound();
        Dispute storage d = _disputes[disputeId];
        if (d.status == DisputeStatus.RESOLVED || d.status == DisputeStatus.DISMISSED || d.status == DisputeStatus.UPHELD) {
            revert AlreadyResolved();
        }

        d.status = newStatus;
        d.resolvedBy = msg.sender;
        d.resolutionNote = resolutionNote;
        d.resolvedAt = block.timestamp;

        emit DisputeResolved(disputeId, newStatus, msg.sender);
    }

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        if (disputeId >= _disputes.length) revert DisputeNotFound();
        return _disputes[disputeId];
    }

    function getDisputesBySubject(address subject) external view returns (uint256[] memory) {
        return _bySubject[subject];
    }

    function getDisputesByFiler(address filer) external view returns (uint256[] memory) {
        return _byFiler[filer];
    }

    function disputeCount() external view returns (uint256) {
        return _disputes.length;
    }

    function getOpenDisputeCount(address subject) external view returns (uint256 count) {
        uint256[] storage ids = _bySubject[subject];
        for (uint256 i = 0; i < ids.length; i++) {
            if (_disputes[ids[i]].status == DisputeStatus.OPEN || _disputes[ids[i]].status == DisputeStatus.UNDER_REVIEW) {
                count++;
            }
        }
    }
}
