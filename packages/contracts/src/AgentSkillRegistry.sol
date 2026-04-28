// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./SkillDefinitionRegistry.sol";

/**
 * @title AgentSkillRegistry
 * @notice Per-agent claim index for skills. Mirrors `GeoClaimRegistry`
 *         with three security upgrades the geo registry doesn't have:
 *
 *   1. **EIP-712 cross-issuance gate.** The `issuer` field is no longer
 *      free; cross-issued claims (where issuer != subject) must carry a
 *      typed-data signature from the named issuer. Closes the "Org B
 *      mints endorsements as Org A" attack the security review found.
 *   2. **Self-attest rate limit.** A subject can mint at most
 *      `SELF_MINT_PER_EPOCH` claims about itself per `EPOCH_SECONDS`
 *      window. Floors discovery autocomplete spam without leaning on
 *      gas alone.
 *   3. **Revocation epoch per (issuer, subject).** Bumping the epoch
 *      invalidates downstream readers' caches deterministically — the
 *      same panic-button pattern the session-grant work shipped in M1.
 *
 * Self-attestation is also capped by `proficiencyScore` ≤ 6000 (≈
 * "advanced") in the verifier — `certifiedIn` is forbidden in the
 * direct-mint path. Issuers who want to attest higher proficiency or a
 * `certifiedIn` relation MUST use the cross-issued path.
 *
 * Locked-in policy id: `smart-agent.skill-overlap.v1`.
 */
contract AgentSkillRegistry {

    // ─── Constants ──────────────────────────────────────────────────

    // v0 relation set — direct skill modalities (subject == claim subject).
    bytes32 public constant HAS_SKILL       = keccak256("skill:hasSkill");
    bytes32 public constant PRACTICES_SKILL = keccak256("skill:practicesSkill");
    bytes32 public constant CERTIFIED_IN    = keccak256("skill:certifiedIn");

    // v1 cross-issuance relations — these are ACTS, not modalities, but
    // share the same struct because the data shape is identical (subject
    // is still "agent the claim is about", issuer is still "who attested").
    // The semantic distinction is enforced by the scorer's relation-weight
    // table; the contract only enforces the cross-issuance gate.
    bytes32 public constant ENDORSES_SKILL  = keccak256("skill:endorsesSkill");
    bytes32 public constant MENTORS_IN      = keccak256("skill:mentorsIn");
    bytes32 public constant CAN_TRAIN       = keccak256("skill:canTrainOthersIn");

    /// @notice Self-attestation rate limit window.
    uint64 public constant EPOCH_SECONDS = 1 days;
    /// @notice Max self-attested mints per (subject, epoch).
    uint8  public constant SELF_MINT_PER_EPOCH = 20;
    /// @notice Hard cap on self-attested proficiencyScore (≈ "advanced" ceiling).
    uint16 public constant SELF_MAX_PROFICIENCY = 6000;
    /// @notice Score scale: 0..10000 (basis points of 0..1.0).
    uint16 public constant MAX_PROFICIENCY_SCORE = 10000;

    /// @dev EIP-712 typehash for SkillEndorsement.
    /// Deliberately omits `nonce` — claimId already commits to a nonce.
    bytes32 public constant ENDORSEMENT_TYPEHASH = keccak256(
        "SkillEndorsement(address subjectAgent,bytes32 skillId,uint64 skillVersion,bytes32 relation,uint16 proficiencyScore,uint64 validAfter,uint64 validUntil,bytes32 nonce)"
    );

    // ─── Visibility ─────────────────────────────────────────────────

    enum Visibility { Public, PublicCoarse, PrivateCommitment, PrivateZk, OffchainOnly }

    // ─── Types ──────────────────────────────────────────────────────

    struct SkillClaim {
        bytes32 claimId;          // keccak256(subject ‖ skillId ‖ relation ‖ nonce)
        address subjectAgent;
        address issuer;           // gated: see mint rules below
        bytes32 skillId;
        uint64  skillVersion;     // pinned snapshot
        bytes32 relation;         // HAS_SKILL | PRACTICES_SKILL | CERTIFIED_IN
        Visibility visibility;
        uint16  proficiencyScore; // 0..10000 (= 0.00–100.00 percent)
        uint8   confidence;       // 0..100; 100 = strongest
        bytes32 evidenceCommit;   // commitment over off-chain evidence; ZK-targetable
        bytes32 edgeId;           // optional AgentRelationship edge (issuer→subject)
        bytes32 assertionId;      // optional ATL Assertion record
        bytes32 policyId;         // hash of "smart-agent.skill-overlap.v1"
        uint64  validAfter;
        uint64  validUntil;
        bool    revoked;
        uint64  createdAt;
        // Revocation epoch at mint time. Readers compare with the current
        // epoch for the (issuer, subject) pair to detect issuer-side
        // bulk invalidation without having to reload every claim.
        uint64  mintedAtEpoch;
    }

    /// @notice Compact mint input — packing avoids stack-too-deep.
    struct MintInput {
        address subjectAgent;
        address issuer;
        bytes32 skillId;
        uint64  skillVersion;
        bytes32 relation;
        Visibility visibility;
        uint16  proficiencyScore;
        uint8   confidence;
        bytes32 evidenceCommit;
        bytes32 edgeId;
        bytes32 assertionId;
        bytes32 policyId;
        uint64  validAfter;
        uint64  validUntil;
        bytes32 nonce;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error ClaimExists();
    error ClaimNotFound();
    error SkillMissing();
    error InvalidScore();
    error RateLimited();
    error InvalidEndorsement();
    error SelfCertNotAllowed();
    error UnknownRelation();

    // ─── Events ─────────────────────────────────────────────────────

    event ClaimMinted(
        bytes32 indexed claimId,
        address indexed subjectAgent,
        address indexed issuer,
        bytes32 skillId,
        uint64  skillVersion,
        bytes32 relation,
        Visibility visibility
    );
    event ClaimRevoked(bytes32 indexed claimId, address indexed by);
    event ClaimEvidenceUpdated(bytes32 indexed claimId, bytes32 newCommit);
    event RevocationEpochBumped(address indexed issuer, address indexed subject, uint64 newEpoch);

    // ─── State ──────────────────────────────────────────────────────

    SkillDefinitionRegistry public immutable SKILLS;

    // EIP-712 domain separator. Cached in storage so chain forks (re-orgs
    // mid-deploy) get re-derived correctly via `_domainSeparator()`.
    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    mapping(bytes32 => SkillClaim) private _claims;
    mapping(address => bytes32[]) private _claimsBySubject;
    mapping(bytes32 => bytes32[]) private _claimsBySkill;
    mapping(bytes32 => bytes32[]) private _claimsByRelation;
    mapping(address => bytes32[]) private _claimsByIssuer;

    /// @notice (subject, epoch-bucket) → count of self-mints in that bucket.
    mapping(address => mapping(uint64 => uint8)) private _selfMintCount;

    /// @notice (issuer, subject) → revocation epoch counter.
    mapping(address => mapping(address => uint64)) public revocationEpoch;

    // ─── Constructor ────────────────────────────────────────────────

    constructor(SkillDefinitionRegistry skills) {
        SKILLS = skills;
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    // ─── Direct mint (subject == issuer) ────────────────────────────

    /**
     * @notice Mint a self-attested skill claim. Must be called by the
     *         subject (or an owner of the subject's smart account).
     *
     * Self-attested claims are capped at `SELF_MAX_PROFICIENCY` and may
     * not use the `CERTIFIED_IN` relation (cert is by definition issued
     * by someone other than the subject).
     *
     * Rate-limited to `SELF_MINT_PER_EPOCH` per subject per `EPOCH_SECONDS`.
     */
    function mintSelf(MintInput calldata input) external returns (bytes32 claimId) {
        if (input.subjectAgent != input.issuer) revert NotAuthorized();
        if (!_isAuthorized(input.subjectAgent)) revert NotAuthorized();
        // certifiedIn is by definition issuer-attested; endorses/mentors/
        // canTrainOthers all describe acts performed BY a third party FOR
        // the subject — none of them are valid as self-attestations.
        if (
            input.relation == CERTIFIED_IN ||
            input.relation == ENDORSES_SKILL ||
            input.relation == MENTORS_IN ||
            input.relation == CAN_TRAIN
        ) revert SelfCertNotAllowed();
        _requireKnownRelation(input.relation);
        if (input.proficiencyScore > SELF_MAX_PROFICIENCY) revert InvalidScore();

        // Rate limit by epoch bucket.
        uint64 bucket = uint64(block.timestamp) / EPOCH_SECONDS;
        uint8 minted = _selfMintCount[input.subjectAgent][bucket];
        if (minted >= SELF_MINT_PER_EPOCH) revert RateLimited();
        _selfMintCount[input.subjectAgent][bucket] = minted + 1;

        return _mint(input);
    }

    // ─── Cross-issued mint (issuer != subject) ──────────────────────

    /**
     * @notice Mint a cross-issued skill claim using an EIP-712 signature
     *         from the named issuer. Caller can be anyone (often the
     *         subject submitting the credential they received from the
     *         issuer); the EIP-712 signature is the proof of issuer
     *         consent. Closes the "impersonate Org A" attack.
     *
     * The signature commits to {subject, skillId, skillVersion, relation,
     * proficiencyScore, validAfter, validUntil, nonce}; readers can
     * recover them deterministically from `_claims[claimId]`.
     */
    function mintWithEndorsement(
        MintInput calldata input,
        bytes calldata endorsementSig
    ) external returns (bytes32 claimId) {
        if (input.issuer == input.subjectAgent) revert NotAuthorized();
        _requireKnownRelation(input.relation);
        if (input.proficiencyScore > MAX_PROFICIENCY_SCORE) revert InvalidScore();

        // Recover the typed-data signature against the issuer.
        bytes32 structHash = keccak256(abi.encode(
            ENDORSEMENT_TYPEHASH,
            input.subjectAgent,
            input.skillId,
            input.skillVersion,
            input.relation,
            input.proficiencyScore,
            input.validAfter,
            input.validUntil,
            input.nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", _domainSeparator(), structHash
        ));
        address recovered = _recover(digest, endorsementSig);
        if (recovered == address(0)) revert InvalidEndorsement();
        // Either the issuer EOA signed directly, or an owner of the issuer
        // smart account signed. The latter is checked by calling the
        // issuer account's `isOwner(recovered)` — same shape as `_isAuthorized`.
        if (recovered != input.issuer) {
            if (input.issuer.code.length == 0) revert InvalidEndorsement();
            (bool ok, bytes memory data) = input.issuer.staticcall(
                abi.encodeWithSignature("isOwner(address)", recovered)
            );
            if (!ok || data.length < 32 || !abi.decode(data, (bool))) revert InvalidEndorsement();
        }

        return _mint(input);
    }

    // ─── Shared mint path ───────────────────────────────────────────

    function _mint(MintInput calldata input) internal returns (bytes32 claimId) {
        // The skill MUST exist at the version pinned in the claim.
        SKILLS.getSkill(input.skillId, input.skillVersion);

        claimId = keccak256(abi.encodePacked(
            input.subjectAgent, input.skillId, input.relation, input.nonce
        ));
        if (_claims[claimId].createdAt != 0) revert ClaimExists();

        _claims[claimId] = SkillClaim({
            claimId: claimId,
            subjectAgent: input.subjectAgent,
            issuer: input.issuer,
            skillId: input.skillId,
            skillVersion: input.skillVersion,
            relation: input.relation,
            visibility: input.visibility,
            proficiencyScore: input.proficiencyScore,
            confidence: input.confidence,
            evidenceCommit: input.evidenceCommit,
            edgeId: input.edgeId,
            assertionId: input.assertionId,
            policyId: input.policyId,
            validAfter: input.validAfter,
            validUntil: input.validUntil,
            revoked: false,
            createdAt: uint64(block.timestamp),
            mintedAtEpoch: revocationEpoch[input.issuer][input.subjectAgent]
        });

        _claimsBySubject[input.subjectAgent].push(claimId);
        _claimsBySkill[input.skillId].push(claimId);
        _claimsByRelation[input.relation].push(claimId);
        _claimsByIssuer[input.issuer].push(claimId);

        emit ClaimMinted(
            claimId, input.subjectAgent, input.issuer,
            input.skillId, input.skillVersion, input.relation, input.visibility
        );
    }

    // ─── Revoke ─────────────────────────────────────────────────────

    function revoke(bytes32 claimId) external {
        SkillClaim storage c = _claims[claimId];
        if (c.createdAt == 0) revert ClaimNotFound();
        if (!_isAuthorized(c.subjectAgent) && !_isAuthorized(c.issuer)) revert NotAuthorized();
        c.revoked = true;
        emit ClaimRevoked(claimId, msg.sender);
    }

    /**
     * @notice Bump the revocation epoch for every claim issued by
     *         `msg.sender` to `subject`. Bulk invalidation without
     *         touching individual claims. Readers compare
     *         `revocationEpoch[claim.issuer][claim.subject]` to
     *         `claim.mintedAtEpoch` — mismatch ⇒ treat as revoked.
     */
    function bumpRevocationEpoch(address subject) external returns (uint64 newEpoch) {
        unchecked { newEpoch = revocationEpoch[msg.sender][subject] + 1; }
        revocationEpoch[msg.sender][subject] = newEpoch;
        emit RevocationEpochBumped(msg.sender, subject, newEpoch);
    }

    /// @notice Re-anchor the evidence commitment after a key rotation, etc.
    function setEvidenceCommit(bytes32 claimId, bytes32 newCommit) external {
        SkillClaim storage c = _claims[claimId];
        if (c.createdAt == 0) revert ClaimNotFound();
        if (!_isAuthorized(c.subjectAgent)) revert NotAuthorized();
        c.evidenceCommit = newCommit;
        emit ClaimEvidenceUpdated(claimId, newCommit);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getClaim(bytes32 claimId) external view returns (SkillClaim memory) {
        SkillClaim storage c = _claims[claimId];
        if (c.createdAt == 0) revert ClaimNotFound();
        return c;
    }

    function claimsBySubject(address subject) external view returns (bytes32[] memory) {
        return _claimsBySubject[subject];
    }
    function claimsBySkill(bytes32 skillId) external view returns (bytes32[] memory) {
        return _claimsBySkill[skillId];
    }
    function claimsByRelation(bytes32 relation) external view returns (bytes32[] memory) {
        return _claimsByRelation[relation];
    }
    function claimsByIssuer(address issuer) external view returns (bytes32[] memory) {
        return _claimsByIssuer[issuer];
    }

    /// @notice Self-mint count for a (subject, current-epoch) pair. Useful for UIs.
    function selfMintsRemaining(address subject) external view returns (uint8) {
        uint64 bucket = uint64(block.timestamp) / EPOCH_SECONDS;
        uint8 used = _selfMintCount[subject][bucket];
        return used >= SELF_MINT_PER_EPOCH ? 0 : SELF_MINT_PER_EPOCH - used;
    }

    /// @notice True iff `claimId`'s `mintedAtEpoch` matches the current
    ///         (issuer, subject) revocationEpoch — i.e. not bulk-invalidated.
    function isFresh(bytes32 claimId) external view returns (bool) {
        SkillClaim storage c = _claims[claimId];
        if (c.createdAt == 0) return false;
        if (c.revoked) return false;
        return c.mintedAtEpoch == revocationEpoch[c.issuer][c.subjectAgent];
    }

    // ─── EIP-712 helpers ────────────────────────────────────────────

    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
        return _buildDomainSeparator();
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("AgentSkillRegistry")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // Same low-s + v normalization as OpenZeppelin's ECDSA.recover.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _requireKnownRelation(bytes32 relation) internal pure {
        if (
            relation != HAS_SKILL &&
            relation != PRACTICES_SKILL &&
            relation != CERTIFIED_IN &&
            relation != ENDORSES_SKILL &&
            relation != MENTORS_IN &&
            relation != CAN_TRAIN
        ) {
            revert UnknownRelation();
        }
    }

    function _isAuthorized(address account) internal view returns (bool) {
        if (msg.sender == account) return true;
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }
}
