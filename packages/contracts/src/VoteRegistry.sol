// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

interface IRoundFundLookup {
    function getRoundFundAgent(bytes32 round) external view returns (address);
}

/**
 * @title VoteRegistry
 * @notice On-chain authoritative store for ballots. Each ballot row carries
 *         only an AnonCreds **nullifier** — never a voter identity — so the
 *         public ledger reveals what was voted on a round, the tally, and
 *         (via nullifier replay protection) that no credential voted twice,
 *         without identifying which member cast which ballot.
 *
 * Subject = keccak256("sa:vote:", roundSubject, nullifier) so the same
 * (round, credential) pair always maps to the same subject — re-casting
 * (vote-change pre-finalize) UPDATEs the row in place instead of inserting
 * a duplicate.
 *
 * Auth: voter eligibility lives off chain. The org-mcp verifies the
 * AnonCreds RoundVoterCredential presentation BEFORE issuing the redeem;
 * the contract itself is permissionless. One-ballot-per-(cred, proposal)
 * is enforced via the (round, proposal, nullifier) subject key — a real
 * nullifier can only be derived by the cred holder, so fabricated rows
 * are simply ignored by tally readers (which filter to nullifiers that
 * match issued creds). The legacy `onlyRoundOperator` gate was removed
 * with unified governance: the round operator is the pool, not any
 * individual member, so a stewardship gate would have prevented members
 * from voting.
 */
contract VoteRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;
    IRoundFundLookup public immutable FUND_REGISTRY;

    bytes32 public constant CLASS_VOTE = keccak256("sa:Vote");

    bytes32 public constant SA_VOTE_ROUND        = keccak256("sa:voteRound");
    bytes32 public constant SA_VOTE_PROPOSAL     = keccak256("sa:voteProposal");
    bytes32 public constant SA_VOTE_BALLOT       = keccak256("sa:voteBallot");
    bytes32 public constant SA_VOTE_NULLIFIER    = keccak256("sa:voteNullifier");
    bytes32 public constant SA_VOTE_WEIGHT       = keccak256("sa:voteWeight");
    bytes32 public constant SA_VOTE_CAST_AT      = keccak256("sa:voteCastAt");
    bytes32 public constant SA_VOTE_UPDATED_AT   = keccak256("sa:voteUpdatedAt");
    bytes32 public constant SA_VOTE_RATIONALE    = keccak256("sa:voteRationale");

    error NotRoundOperator();
    error VoteNotFound();

    event VoteCast(
        bytes32 indexed voteSubject,
        bytes32 indexed roundSubject,
        bytes32 indexed nullifier,
        bytes32 ballot,
        uint256 weight
    );
    event VoteUpdated(
        bytes32 indexed voteSubject,
        bytes32 newBallot,
        uint256 newWeight
    );

    struct CastVoteParams {
        bytes32 roundSubject;
        bytes32 nullifier;        // hex-decoded keccak256(credId || ':' || `vote:${roundId}`)
        bytes32 proposalSubject;  // FundRegistry/ProposalRegistry subject id for the targeted proposal
        bytes32 ballot;           // concept hash: keccak256("sa:Approve") | "sa:Reject" | "sa:Abstain"
        uint256 weight;
        string  rationale;        // optional; empty string for "no rationale provided"
    }

    constructor(address ontologyRegistry, address shapes, address fundRegistry)
        AttributeStorage(ontologyRegistry)
    {
        SHAPES = ShapeRegistry(shapes);
        FUND_REGISTRY = IRoundFundLookup(fundRegistry);
    }

    /// Vote uniqueness key — one voter can cast across many proposals
    /// in a round, but only one ballot per (round, proposal, voter).
    /// Recasting on the same proposal UPSERTs.
    function _voteSubject(
        bytes32 roundSubject,
        bytes32 proposalSubject,
        bytes32 nullifier
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("sa:vote:", roundSubject, proposalSubject, nullifier));
    }

    function voteSubject(
        bytes32 roundSubject,
        bytes32 proposalSubject,
        bytes32 nullifier
    ) external pure returns (bytes32) {
        return _voteSubject(roundSubject, proposalSubject, nullifier);
    }

    function castVote(CastVoteParams calldata p) external {
        bytes32 subj = _voteSubject(p.roundSubject, p.proposalSubject, p.nullifier);
        bool isUpdate = this.isSet(subj, SA_VOTE_BALLOT);
        _setBytes32(subj, SA_VOTE_ROUND, p.roundSubject);
        _setBytes32(subj, SA_VOTE_PROPOSAL, p.proposalSubject);
        _setBytes32(subj, SA_VOTE_BALLOT, p.ballot);
        _setBytes32(subj, SA_VOTE_NULLIFIER, p.nullifier);
        _setUint(subj, SA_VOTE_WEIGHT, p.weight);
        _setUint(subj, SA_VOTE_UPDATED_AT, block.timestamp);
        if (!isUpdate) {
            _setUint(subj, SA_VOTE_CAST_AT, block.timestamp);
            emit VoteCast(subj, p.roundSubject, p.nullifier, p.ballot, p.weight);
        } else {
            emit VoteUpdated(subj, p.ballot, p.weight);
        }
        if (bytes(p.rationale).length > 0) {
            _setString(subj, SA_VOTE_RATIONALE, p.rationale);
        }
        SHAPES.validateSubject(CLASS_VOTE, subj, address(this));
    }

    // ─── Read helpers ──────────────────────────────────────────────

    function getBallot(bytes32 voteSubj) external view returns (bytes32) {
        return this.getBytes32(voteSubj, SA_VOTE_BALLOT);
    }
    function getNullifier(bytes32 voteSubj) external view returns (bytes32) {
        return this.getBytes32(voteSubj, SA_VOTE_NULLIFIER);
    }
    function getProposal(bytes32 voteSubj) external view returns (bytes32) {
        return this.getBytes32(voteSubj, SA_VOTE_PROPOSAL);
    }
    function getWeight(bytes32 voteSubj) external view returns (uint256) {
        return this.getUint(voteSubj, SA_VOTE_WEIGHT);
    }
    function getCastAt(bytes32 voteSubj) external view returns (uint256) {
        return this.getUint(voteSubj, SA_VOTE_CAST_AT);
    }
}
