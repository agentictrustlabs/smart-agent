// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title CredentialRegistry
 * @notice On-chain Data Layer Registry for AnonCreds (cheqd-style).
 *
 *   Schemas and credential definitions are PUBLISHED on-chain in full: the
 *   canonical-JSON bytes land in event data (cheap LOG cost, not SSTORE).
 *   A verifier with only an RPC URL and this contract address can resolve
 *   and verify every credential it sees — the issuer is NOT in the
 *   verification path.
 *
 *   Identity. An issuer registers its did:ethr by proving control of the
 *   EOA. The on-chain msg.sender of every publish* call IS the provenance
 *   of the published record — no off-chain signature required.
 *
 *   Storage model. We keep two sentinels on-chain per id:
 *     - the indexed jsonHash (so log filters are cheap), and
 *     - a "published" flag (so re-publish is rejected).
 *   The canonical JSON itself lives in the event's non-indexed data, which
 *   a full-archive RPC node returns via eth_getLogs.
 *
 *   Revocation. Reserved as RevStatusUpdated below (not implemented — the
 *   credentials we mint in this build are non-revocable).
 */
contract CredentialRegistry {
    struct Issuer {
        string did;
        address account;
        uint64 registeredAt;
    }

    mapping(string => Issuer) private _issuers;            // did -> Issuer
    mapping(address => string) private _didByAddress;      // address -> did

    // Sentinels. We only need to prove "was published" and bind to a hash —
    // the canonical-JSON payload is recovered from event data, not SSTORE.
    mapping(bytes32 => bytes32) private _schemaJsonHash;   // keccak(id) -> keccak(canonicalJson)
    mapping(bytes32 => address) private _schemaIssuer;     // keccak(id) -> msg.sender

    mapping(bytes32 => bytes32) private _credDefJsonHash;  // keccak(id) -> keccak(canonicalJson)
    mapping(bytes32 => address) private _credDefIssuer;    // keccak(id) -> msg.sender
    mapping(bytes32 => bytes32) private _credDefSchema;    // keccak(credDefId) -> keccak(schemaId)

    event IssuerRegistered(string did, address indexed account, uint64 at);

    /// @notice Emitted when a schema is published. `canonicalJson` is the full
    /// AnonCreds schema payload (minified, key-sorted). Verifiers recover it
    /// from event data and check keccak256(canonicalJson) == jsonHash.
    event SchemaPublished(
        bytes32 indexed schemaIdKey,     // keccak256(bytes(id))
        bytes32 indexed jsonHash,        // keccak256(canonicalJson)
        address indexed issuer,
        string id,
        bytes canonicalJson,
        uint64 at
    );

    /// @notice Emitted when a credential definition is published.
    event CredDefPublished(
        bytes32 indexed credDefIdKey,    // keccak256(bytes(id))
        bytes32 indexed jsonHash,        // keccak256(canonicalJson)
        address indexed issuer,
        string id,
        string schemaId,
        bytes canonicalJson,
        uint64 at
    );

    /// @notice Reserved for future revocation-status updates. Not yet emitted.
    event RevStatusUpdated(
        bytes32 indexed credDefIdKey,
        uint64 indexed sequence,
        bytes32 indexed deltaHash,
        address issuer,
        bytes delta,
        uint64 at
    );

    error NotIssuerAccount();
    error IssuerAlreadyRegistered();
    error UnknownIssuer();
    error SchemaAlreadyPublished();
    error CredDefAlreadyPublished();
    error UnknownSchema();
    error EmptyId();
    error EmptyJson();

    /// @notice Register a did:ethr issuer. The caller MUST be the EOA in the DID.
    function registerIssuer(string calldata did, address account) external {
        if (msg.sender != account) revert NotIssuerAccount();
        if (_issuers[did].account != address(0)) revert IssuerAlreadyRegistered();
        _issuers[did] = Issuer({ did: did, account: account, registeredAt: uint64(block.timestamp) });
        _didByAddress[account] = did;
        emit IssuerRegistered(did, account, uint64(block.timestamp));
    }

    /// @notice Publish a schema. The canonical-JSON bytes are emitted in event
    /// data; only the keccak hashes are stored on-chain. Caller must be a
    /// registered issuer. One publish per id.
    function publishSchema(string calldata id, bytes calldata canonicalJson) external {
        if (bytes(_didByAddress[msg.sender]).length == 0) revert UnknownIssuer();
        if (bytes(id).length == 0) revert EmptyId();
        if (canonicalJson.length == 0) revert EmptyJson();
        bytes32 key = keccak256(bytes(id));
        if (_schemaIssuer[key] != address(0)) revert SchemaAlreadyPublished();
        bytes32 jsonHash = keccak256(canonicalJson);
        _schemaJsonHash[key] = jsonHash;
        _schemaIssuer[key] = msg.sender;
        emit SchemaPublished(key, jsonHash, msg.sender, id, canonicalJson, uint64(block.timestamp));
    }

    /// @notice Publish a credential definition bound to an already-published
    /// schema. Canonical-JSON lives in event data.
    function publishCredDef(
        string calldata id,
        string calldata schemaId,
        bytes calldata canonicalJson
    ) external {
        if (bytes(_didByAddress[msg.sender]).length == 0) revert UnknownIssuer();
        if (bytes(id).length == 0) revert EmptyId();
        if (canonicalJson.length == 0) revert EmptyJson();
        bytes32 schemaKey = keccak256(bytes(schemaId));
        if (_schemaIssuer[schemaKey] == address(0)) revert UnknownSchema();
        bytes32 key = keccak256(bytes(id));
        if (_credDefIssuer[key] != address(0)) revert CredDefAlreadyPublished();
        bytes32 jsonHash = keccak256(canonicalJson);
        _credDefJsonHash[key] = jsonHash;
        _credDefIssuer[key] = msg.sender;
        _credDefSchema[key] = schemaKey;
        emit CredDefPublished(key, jsonHash, msg.sender, id, schemaId, canonicalJson, uint64(block.timestamp));
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    function getIssuer(string calldata did) external view returns (Issuer memory) {
        return _issuers[did];
    }

    function getIssuerByAddress(address account) external view returns (Issuer memory) {
        string memory did = _didByAddress[account];
        return _issuers[did];
    }

    function isSchemaPublished(string calldata id) external view returns (bool) {
        return _schemaIssuer[keccak256(bytes(id))] != address(0);
    }

    function isCredDefPublished(string calldata id) external view returns (bool) {
        return _credDefIssuer[keccak256(bytes(id))] != address(0);
    }

    /// @notice Sentinel view — verifier checks keccak(canonicalJson) against
    /// the hash stored on-chain. Canonical bytes are fetched from event data.
    function schemaJsonHash(string calldata id) external view returns (bytes32) {
        return _schemaJsonHash[keccak256(bytes(id))];
    }

    function credDefJsonHash(string calldata id) external view returns (bytes32) {
        return _credDefJsonHash[keccak256(bytes(id))];
    }

    function schemaIssuerOf(string calldata id) external view returns (address) {
        return _schemaIssuer[keccak256(bytes(id))];
    }

    function credDefIssuerOf(string calldata id) external view returns (address) {
        return _credDefIssuer[keccak256(bytes(id))];
    }
}
