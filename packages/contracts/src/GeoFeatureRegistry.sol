// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";

/**
 * @title GeoFeatureRegistry
 * @notice Versioned, name-bound registry of geographic features.
 *
 * The registry stores small, indexable summaries; canonical geometry lives
 * off-chain (GeoJSON RFC 7946 / WKT) and is anchored on-chain by
 * `geometryHash` (keccak256 of the canonical-encoded payload). On-chain
 * fields are deliberately kept to indexable scalars and Merkle roots:
 *
 *   • centroid (lat/lon as int256 * 1e7)  — coarse map placement only
 *   • bbox     (4 × int256 * 1e7)          — coarse pre-filter only
 *   • h3CoverageRoot (bytes32)             — Merkle root over the H3 cells
 *                                             (resolution 6 default) covering
 *                                             this feature's geometry. Used
 *                                             by `H3MembershipInCoverageRoot`
 *                                             ZK proofs for private claim
 *                                             matching without revealing
 *                                             the holder's exact H3 cell.
 *   • sourceSetRoot (bytes32)              — Merkle root over the source
 *                                             dataset records (e.g. census
 *                                             tract ids, OSM relation ids)
 *                                             this feature was derived from,
 *                                             so verifiers can audit
 *                                             provenance without storing
 *                                             the entire dataset.
 *
 * Names (.geo and any ancestor: us.geo, colorado.us.geo, …) are HANDLES,
 * not spatial truth. Each feature can have many name bindings over time,
 * and each name binding can be re-pointed to a new featureVersion when
 * boundaries change without invalidating prior claims that reference the
 * older version.
 *
 * Claim writes do NOT happen here — see `GeoClaimRegistry`. This contract
 * is the source of truth for "what is feature F at version V".
 */
contract GeoFeatureRegistry {

    // ─── Constants ──────────────────────────────────────────────────

    /// @notice Coordinate scale: stored value = round(degrees * 1e7).
    int256 public constant COORD_SCALE = 1e7;

    // Well-known feature kinds. Callers may pass any bytes32, but these
    // are the SDK-recognised ones used by the seed + UI.
    bytes32 public constant KIND_PLANET       = keccak256("geo:Planet");
    bytes32 public constant KIND_COUNTRY      = keccak256("geo:Country");
    bytes32 public constant KIND_STATE        = keccak256("geo:State");
    bytes32 public constant KIND_COUNTY       = keccak256("geo:County");
    bytes32 public constant KIND_MUNICIPALITY = keccak256("geo:Municipality");
    bytes32 public constant KIND_NEIGHBORHOOD = keccak256("geo:Neighborhood");
    bytes32 public constant KIND_ZIPCODE      = keccak256("geo:ZipCode");
    bytes32 public constant KIND_CUSTOM       = keccak256("geo:Custom");

    // ─── Types ──────────────────────────────────────────────────────

    struct FeatureRecord {
        bytes32 featureId;       // stable id across versions (keccak256(canonicalKey))
        uint64  version;         // monotonically increasing per featureId
        address stewardAccount;  // AgentAccount that owns/maintains this feature
        bytes32 featureKind;     // KIND_* tag
        bytes32 geometryHash;    // keccak256 of canonical GeoJSON payload
        bytes32 h3CoverageRoot;  // Merkle root over H3-resolution-6 covering cells
        bytes32 sourceSetRoot;   // Merkle root over the source dataset records
        string  metadataURI;     // ipfs://... or https://... pointing at full payload
        // Centroid + bbox (degrees * 1e7). Used for cheap UI rendering and
        // pre-filtering candidate features; never as canonical truth.
        int256  centroidLat;
        int256  centroidLon;
        int256  bboxMinLat;
        int256  bboxMinLon;
        int256  bboxMaxLat;
        int256  bboxMaxLon;
        // Validity window — `validAfter` = 0 means "since registry inception",
        // `validUntil` = 0 means "indefinite". Versions are still distinct
        // even if the validity window is open-ended.
        uint64  validAfter;
        uint64  validUntil;
        bool    active;
        uint64  registeredAt;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotAuthorized();
    error FeatureNotFound();
    error VersionExists();
    error InvalidLabel();
    error EmptyMetadata();

    // ─── Events ─────────────────────────────────────────────────────

    event FeaturePublished(
        bytes32 indexed featureId,
        uint64  indexed version,
        address indexed steward,
        bytes32 featureKind,
        bytes32 geometryHash,
        bytes32 h3CoverageRoot,
        bytes32 sourceSetRoot,
        string  metadataURI
    );
    event FeatureNameBound(bytes32 indexed featureId, bytes32 indexed nameNode, uint64 version);
    event FeatureNameUnbound(bytes32 indexed featureId, bytes32 indexed nameNode);
    event FeatureDeactivated(bytes32 indexed featureId, uint64 version);
    event FeatureValidityChanged(bytes32 indexed featureId, uint64 version, uint64 validAfter, uint64 validUntil);

    // ─── State ──────────────────────────────────────────────────────

    AgentNameRegistry public immutable NAMES;

    /// @notice featureId → version → record.
    mapping(bytes32 => mapping(uint64 => FeatureRecord)) private _records;
    /// @notice featureId → highest published version.
    mapping(bytes32 => uint64) public latestVersion;
    /// @notice nameNode → featureId. A given .geo name binds to exactly one feature.
    mapping(bytes32 => bytes32) public featureForName;
    /// @notice featureId → list of bound name nodes (in binding order).
    mapping(bytes32 => bytes32[]) private _featureNames;

    bytes32[] private _allFeatures; // first-publish enumeration

    // ─── Constructor ────────────────────────────────────────────────

    constructor(AgentNameRegistry names) {
        NAMES = names;
    }

    // ─── Publish / version ──────────────────────────────────────────

    /**
     * @notice Publish a new version of a feature.
     * @dev featureId is stable across versions; version monotonically
     *      increments. The first call for a given featureId starts at v1.
     *      Caller must be the steward (or an owner of stewardAccount).
     */
    function publish(
        bytes32 featureId,
        bytes32 featureKind,
        address stewardAccount,
        bytes32 geometryHash,
        bytes32 h3CoverageRoot,
        bytes32 sourceSetRoot,
        string calldata metadataURI,
        int256 centroidLat,
        int256 centroidLon,
        int256 bboxMinLat,
        int256 bboxMinLon,
        int256 bboxMaxLat,
        int256 bboxMaxLon,
        uint64 validAfter,
        uint64 validUntil
    ) external returns (uint64 newVersion) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();

        // Authorization: the steward (or an owner of the stewardAccount).
        if (latestVersion[featureId] == 0) {
            // First publish — caller must be the steward
            if (!_isAuthorized(stewardAccount)) revert NotAuthorized();
        } else {
            // Subsequent versions — caller must match the existing steward
            FeatureRecord storage prev = _records[featureId][latestVersion[featureId]];
            if (!_isAuthorized(prev.stewardAccount)) revert NotAuthorized();
            if (stewardAccount != prev.stewardAccount) revert NotAuthorized();
        }

        newVersion = latestVersion[featureId] + 1;

        _records[featureId][newVersion] = FeatureRecord({
            featureId: featureId,
            version: newVersion,
            stewardAccount: stewardAccount,
            featureKind: featureKind,
            geometryHash: geometryHash,
            h3CoverageRoot: h3CoverageRoot,
            sourceSetRoot: sourceSetRoot,
            metadataURI: metadataURI,
            centroidLat: centroidLat,
            centroidLon: centroidLon,
            bboxMinLat: bboxMinLat,
            bboxMinLon: bboxMinLon,
            bboxMaxLat: bboxMaxLat,
            bboxMaxLon: bboxMaxLon,
            validAfter: validAfter,
            validUntil: validUntil,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        latestVersion[featureId] = newVersion;
        if (newVersion == 1) _allFeatures.push(featureId);

        emit FeaturePublished(
            featureId, newVersion, stewardAccount,
            featureKind, geometryHash, h3CoverageRoot, sourceSetRoot, metadataURI
        );
    }

    /// @notice Mark the latest version of a feature inactive (e.g. annexed boundary).
    function deactivate(bytes32 featureId) external {
        uint64 v = latestVersion[featureId];
        if (v == 0) revert FeatureNotFound();
        FeatureRecord storage r = _records[featureId][v];
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();
        r.active = false;
        emit FeatureDeactivated(featureId, v);
    }

    /// @notice Update the validity window of a published version (e.g. set sunset date).
    function setValidity(bytes32 featureId, uint64 version, uint64 validAfter, uint64 validUntil) external {
        FeatureRecord storage r = _records[featureId][version];
        if (r.registeredAt == 0) revert FeatureNotFound();
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();
        r.validAfter = validAfter;
        r.validUntil = validUntil;
        emit FeatureValidityChanged(featureId, version, validAfter, validUntil);
    }

    // ─── Name bindings ──────────────────────────────────────────────

    /**
     * @notice Bind a `.geo` name node to this feature.
     * @dev Caller must be the name's owner AND the feature's steward.
     */
    function bindName(bytes32 featureId, bytes32 nameNode) external {
        if (latestVersion[featureId] == 0) revert FeatureNotFound();
        FeatureRecord storage r = _records[featureId][latestVersion[featureId]];
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();

        address nameOwner = NAMES.owner(nameNode);
        if (nameOwner == address(0)) revert InvalidLabel();
        if (!_isAuthorized(nameOwner)) revert NotAuthorized();

        // Re-binding an existing name to a different feature: drop the old link.
        bytes32 prior = featureForName[nameNode];
        if (prior != bytes32(0) && prior != featureId) {
            emit FeatureNameUnbound(prior, nameNode);
        }

        featureForName[nameNode] = featureId;
        _featureNames[featureId].push(nameNode);
        emit FeatureNameBound(featureId, nameNode, r.version);
    }

    function unbindName(bytes32 nameNode) external {
        bytes32 fid = featureForName[nameNode];
        if (fid == bytes32(0)) revert InvalidLabel();
        FeatureRecord storage r = _records[fid][latestVersion[fid]];
        if (!_isAuthorized(r.stewardAccount)) revert NotAuthorized();
        delete featureForName[nameNode];
        emit FeatureNameUnbound(fid, nameNode);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getFeature(bytes32 featureId, uint64 version) external view returns (FeatureRecord memory) {
        FeatureRecord storage r = _records[featureId][version];
        if (r.registeredAt == 0) revert FeatureNotFound();
        return r;
    }

    /// @notice Convenience: the most recent published version for a feature.
    function getLatest(bytes32 featureId) external view returns (FeatureRecord memory) {
        uint64 v = latestVersion[featureId];
        if (v == 0) revert FeatureNotFound();
        return _records[featureId][v];
    }

    function getNames(bytes32 featureId) external view returns (bytes32[] memory) {
        return _featureNames[featureId];
    }

    function allFeatures() external view returns (bytes32[] memory) {
        return _allFeatures;
    }

    // ─── Auth ───────────────────────────────────────────────────────

    function _isAuthorized(address account) internal view returns (bool) {
        if (msg.sender == account) return true;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        return ok && abi.decode(data, (bool));
    }
}
