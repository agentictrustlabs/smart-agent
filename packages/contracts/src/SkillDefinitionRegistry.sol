// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";

/**
 * @title SkillDefinitionRegistry
 * @notice Versioned, content-addressed taxonomy of "what is this skill?"
 *
 * Mirrors `GeoFeatureRegistry` for the skills domain. The on-chain row is
 * a small indexable summary; canonical SKOS triples (synonyms, broader /
 * narrower / related, OASF mapping) live off-chain and are anchored by
 * `ontologyMerkleRoot` (URDNA2015-canonical N-Quads → keccak256 root).
 *
 * Hierarchical "skill X is a kind of skill Y" relationships are NOT stored
 * on chain — that hierarchy lives in the SKOS graph. Putting it on chain
 * would force a new version every time the upstream taxonomy is re-parented.
 *
 * Each `SkillRecord` version pins:
 *   • `ontologyMerkleRoot`  — Merkle root over the canonical SKOS subtree
 *                             for this skill (label, altLabels, broader,
 *                             narrower, related, OASF mapping).
 *   • `predecessorMerkleRoot` — root of the prior version (or zero), so
 *                             diffs are auditable across taxonomy refreshes.
 *   • `metadataURI` carries the JSON-LD blob plus a top-level
 *     `oasfRelease` tag (e.g. "oasf-0.5.2") so two stewards re-importing
 *     the same OASF concept on different days produce identical
 *     `conceptHash`.
 *
 * Names (`.skill` and any ancestor) are HANDLES, not canonical truth.
 * v1 adds `bindName` paralleling `GeoFeatureRegistry.bindName` so the
 * `.skill` TLD can alias canonical `skillId`s. The `NAMES` reference is
 * optional — pass `address(0)` at deploy if `.skill` isn't initialised
 * yet (binds become a no-op revert until the registry is wired).
 *
 * Claim writes do NOT happen here — see `AgentSkillRegistry`. This contract
 * is the source of truth for "what is skill S at version V".
 */
contract SkillDefinitionRegistry {

    // ─── Constants ──────────────────────────────────────────────────

    bytes32 public constant KIND_OASF_LEAF = keccak256("skill:OasfLeaf");
    bytes32 public constant KIND_DOMAIN    = keccak256("skill:Domain");
    bytes32 public constant KIND_CUSTOM    = keccak256("skill:Custom");

    // ─── Types ──────────────────────────────────────────────────────

    struct SkillRecord {
        bytes32 skillId;                // stable id across versions; = keccak256(canonical-id)
        uint64  version;                // monotonic per skillId
        address stewardAccount;         // governing steward (may be an Org agent)
        bytes32 skillKind;              // KIND_* tag
        bytes32 conceptHash;            // keccak256(SKOS prefLabel + ancestors normalized)
        bytes32 ontologyMerkleRoot;     // anchors RDF/SKOS expansion (canonical N-Quads)
        bytes32 predecessorMerkleRoot;  // prior version's root (or zero for v1)
        string  metadataURI;            // ipfs://... or https://... JSON-LD blob; carries oasfRelease tag
        // Validity window — `validAfter` = 0 means "since registry inception",
        // `validUntil` = 0 means "indefinite".
        uint64  validAfter;
        uint64  validUntil;
        bool    active;
        uint64  registeredAt;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error SkillNotFound();
    error EmptyMetadata();
    error InvalidLabel();
    error NamesNotConfigured();

    // ─── Events ─────────────────────────────────────────────────────

    event SkillPublished(
        bytes32 indexed skillId,
        uint64  indexed version,
        address indexed steward,
        bytes32 skillKind,
        bytes32 conceptHash,
        bytes32 ontologyMerkleRoot,
        bytes32 predecessorMerkleRoot,
        string  metadataURI
    );
    event SkillDeactivated(bytes32 indexed skillId, uint64 version);
    event SkillValidityChanged(bytes32 indexed skillId, uint64 version, uint64 validAfter, uint64 validUntil);
    event SkillNameBound(bytes32 indexed skillId, bytes32 indexed nameNode, uint64 version);
    event SkillNameUnbound(bytes32 indexed skillId, bytes32 indexed nameNode);

    // ─── State ──────────────────────────────────────────────────────

    /// @notice Optional `.skill` TLD registry. When the zero address, name
    ///         binds revert with `NamesNotConfigured`. Wired on first deploy
    ///         that includes the `.skill` root initialisation.
    address public immutable NAMES;

    mapping(bytes32 => mapping(uint64 => SkillRecord)) private _records;
    mapping(bytes32 => uint64) public latestVersion;
    bytes32[] private _allSkills; // first-publish enumeration

    /// @notice nameNode → skillId. A `.skill` name binds to exactly one skill.
    mapping(bytes32 => bytes32) public skillForName;
    /// @notice skillId → list of bound name nodes (in binding order).
    mapping(bytes32 => bytes32[]) private _skillNames;

    // ─── Constructor ────────────────────────────────────────────────

    /**
     * @param namesRegistry Optional `AgentNameRegistry` address for `.skill`
     *        TLD binds. Pass `address(0)` to defer name wiring.
     */
    constructor(address namesRegistry) {
        NAMES = namesRegistry;
    }

    // ─── Publish / version ──────────────────────────────────────────

    /**
     * @notice Publish a new version of a skill definition.
     * @dev skillId is stable across versions; version monotonically
     *      increments. The first call for a given skillId starts at v1.
     *      Caller must be the steward (or an owner of stewardAccount).
     */
    function publish(
        bytes32 skillId,
        bytes32 skillKind,
        address stewardAccount,
        bytes32 conceptHash,
        bytes32 ontologyMerkleRoot,
        bytes32 predecessorMerkleRoot,
        string calldata metadataURI,
        uint64 validAfter,
        uint64 validUntil
    ) external returns (uint64 newVersion) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();

        if (latestVersion[skillId] == 0) {
            // First publish — caller must be the steward
            if (!_isAuthorized(stewardAccount)) revert NotAuthorized();
        } else {
            // Subsequent versions — caller must match the existing steward
            SkillRecord storage prev = _records[skillId][latestVersion[skillId]];
            if (!_isAuthorized(prev.stewardAccount)) revert NotAuthorized();
            if (stewardAccount != prev.stewardAccount) revert NotAuthorized();
        }

        newVersion = latestVersion[skillId] + 1;

        _records[skillId][newVersion] = SkillRecord({
            skillId: skillId,
            version: newVersion,
            stewardAccount: stewardAccount,
            skillKind: skillKind,
            conceptHash: conceptHash,
            ontologyMerkleRoot: ontologyMerkleRoot,
            predecessorMerkleRoot: predecessorMerkleRoot,
            metadataURI: metadataURI,
            validAfter: validAfter,
            validUntil: validUntil,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        latestVersion[skillId] = newVersion;
        if (newVersion == 1) _allSkills.push(skillId);

        emit SkillPublished(
            skillId, newVersion, stewardAccount,
            skillKind, conceptHash, ontologyMerkleRoot, predecessorMerkleRoot, metadataURI
        );
    }

    /// @notice Mark the latest version of a skill inactive (e.g. taxonomy retirement).
    function deactivate(bytes32 skillId) external {
        uint64 v = latestVersion[skillId];
        if (v == 0) revert SkillNotFound();
        SkillRecord storage r = _records[skillId][v];
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();
        r.active = false;
        emit SkillDeactivated(skillId, v);
    }

    /// @notice Update the validity window of a published version.
    function setValidity(bytes32 skillId, uint64 version, uint64 validAfter, uint64 validUntil) external {
        SkillRecord storage r = _records[skillId][version];
        if (r.registeredAt == 0) revert SkillNotFound();
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();
        r.validAfter = validAfter;
        r.validUntil = validUntil;
        emit SkillValidityChanged(skillId, version, validAfter, validUntil);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getSkill(bytes32 skillId, uint64 version) external view returns (SkillRecord memory) {
        SkillRecord storage r = _records[skillId][version];
        if (r.registeredAt == 0) revert SkillNotFound();
        return r;
    }

    function getLatest(bytes32 skillId) external view returns (SkillRecord memory) {
        uint64 v = latestVersion[skillId];
        if (v == 0) revert SkillNotFound();
        return _records[skillId][v];
    }

    function allSkills() external view returns (bytes32[] memory) {
        return _allSkills;
    }

    function namesOf(bytes32 skillId) external view returns (bytes32[] memory) {
        return _skillNames[skillId];
    }

    // ─── Name bindings (.skill TLD) ─────────────────────────────────

    /**
     * @notice Bind a `.skill` name node to this skill. Caller must be the
     *         skill's steward AND the name's owner.
     * @dev Mirrors `GeoFeatureRegistry.bindName`. The on-chain canonical
     *      handle is still `skillId`; the name is a developer-friendly
     *      alias (and the source of truth for the SDK's reverse
     *      `nameToSkillId` lookup).
     */
    function bindName(bytes32 skillId, bytes32 nameNode) external {
        if (NAMES == address(0)) revert NamesNotConfigured();
        if (latestVersion[skillId] == 0) revert SkillNotFound();
        SkillRecord storage r = _records[skillId][latestVersion[skillId]];
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();

        (bool ok, bytes memory data) = NAMES.staticcall(
            abi.encodeWithSignature("owner(bytes32)", nameNode)
        );
        if (!ok || data.length < 32) revert InvalidLabel();
        address nameOwner = abi.decode(data, (address));
        if (nameOwner == address(0)) revert InvalidLabel();
        if (!_isAuthorized(nameOwner)) revert NotAuthorized();

        // Re-binding an existing name to a different skill: drop the old link.
        bytes32 prior = skillForName[nameNode];
        if (prior != bytes32(0) && prior != skillId) {
            emit SkillNameUnbound(prior, nameNode);
        }

        skillForName[nameNode] = skillId;
        _skillNames[skillId].push(nameNode);
        emit SkillNameBound(skillId, nameNode, r.version);
    }

    function unbindName(bytes32 nameNode) external {
        bytes32 sid = skillForName[nameNode];
        if (sid == bytes32(0)) revert InvalidLabel();
        SkillRecord storage r = _records[sid][latestVersion[sid]];
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();
        delete skillForName[nameNode];
        emit SkillNameUnbound(sid, nameNode);
    }

    // ─── Auth ───────────────────────────────────────────────────────

    function _isAuthorized(address account) internal view returns (bool) {
        if (msg.sender == account) return true;
        // Skip the staticcall for EOAs — they don't implement isOwner and
        // returning empty data would revert in abi.decode.
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }
}
