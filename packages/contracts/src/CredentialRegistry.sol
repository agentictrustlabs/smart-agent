// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title CredentialRegistry
 * @notice On-chain anchor for the off-chain AnonCreds registry (Phase 6).
 *
 *   An issuer (identified by its secp256k1 EOA) anchors hashes of its schema
 *   and credential-definition public records. The wallet and verifier use
 *   these anchors as a tamper-evidence layer on top of the off-chain signed
 *   JSON: if a reader can see a valid signature AND the on-chain anchor hash
 *   matches the canonical bytes they read, the record is authentic.
 *
 *   - registerIssuer(did, address)      caller must prove control of address
 *   - anchorSchema(id, hash)            caller must be the issuer
 *   - anchorCredDef(id, hash, schemaId) caller must be the issuer
 *
 *   Hashes are 32-byte keccak256 digests of the canonical-JSON public record,
 *   matching the off-chain `recordDigest(...)` used by the signing helpers.
 *
 *   Optional trust gating (Phase 6 stretch): a caveat enforcer can require a
 *   valid membership proof against an anchored credDef before allowing a
 *   delegation to be redeemed. That enforcer is NOT part of this contract.
 */
contract CredentialRegistry {
    struct Issuer {
        string did;
        address account;
        uint64 registeredAt;
    }

    struct SchemaAnchor {
        string id;
        bytes32 recordHash;
        address issuer;
        uint64 anchoredAt;
    }

    struct CredDefAnchor {
        string id;
        bytes32 recordHash;
        string schemaId;
        address issuer;
        uint64 anchoredAt;
    }

    mapping(string => Issuer) private _issuers;              // did -> Issuer
    mapping(address => string) private _didByAddress;        // address -> did

    mapping(string => SchemaAnchor) private _schemas;        // schemaId -> anchor
    mapping(string => CredDefAnchor) private _credDefs;      // credDefId -> anchor

    event IssuerRegistered(string did, address indexed account, uint64 at);
    event SchemaAnchored(string id, bytes32 indexed recordHash, address indexed issuer, uint64 at);
    event CredDefAnchored(string id, bytes32 indexed recordHash, string schemaId, address indexed issuer, uint64 at);

    error NotIssuerAccount();
    error IssuerAlreadyRegistered();
    error UnknownIssuer();
    error SchemaAlreadyAnchored();
    error CredDefAlreadyAnchored();
    error UnknownSchema();

    /// @notice Register a did:ethr issuer. The caller MUST be the EOA in the DID.
    function registerIssuer(string calldata did, address account) external {
        if (msg.sender != account) revert NotIssuerAccount();
        if (_issuers[did].account != address(0)) revert IssuerAlreadyRegistered();
        _issuers[did] = Issuer({ did: did, account: account, registeredAt: uint64(block.timestamp) });
        _didByAddress[account] = did;
        emit IssuerRegistered(did, account, uint64(block.timestamp));
    }

    /// @notice Anchor a schema hash. Caller must be the registered issuer account.
    function anchorSchema(string calldata id, bytes32 recordHash) external {
        if (bytes(_didByAddress[msg.sender]).length == 0) revert UnknownIssuer();
        if (_schemas[id].issuer != address(0)) revert SchemaAlreadyAnchored();
        _schemas[id] = SchemaAnchor({
            id: id,
            recordHash: recordHash,
            issuer: msg.sender,
            anchoredAt: uint64(block.timestamp)
        });
        emit SchemaAnchored(id, recordHash, msg.sender, uint64(block.timestamp));
    }

    /// @notice Anchor a credDef hash. Caller must be the registered issuer.
    function anchorCredDef(
        string calldata id,
        bytes32 recordHash,
        string calldata schemaId
    ) external {
        if (bytes(_didByAddress[msg.sender]).length == 0) revert UnknownIssuer();
        if (_schemas[schemaId].issuer == address(0)) revert UnknownSchema();
        if (_credDefs[id].issuer != address(0)) revert CredDefAlreadyAnchored();
        _credDefs[id] = CredDefAnchor({
            id: id,
            recordHash: recordHash,
            schemaId: schemaId,
            issuer: msg.sender,
            anchoredAt: uint64(block.timestamp)
        });
        emit CredDefAnchored(id, recordHash, schemaId, msg.sender, uint64(block.timestamp));
    }

    // ─── Reads ──────────────────────────────────────────────────────────

    function getIssuer(string calldata did) external view returns (Issuer memory) {
        return _issuers[did];
    }

    function getIssuerByAddress(address account) external view returns (Issuer memory) {
        string memory did = _didByAddress[account];
        return _issuers[did];
    }

    function getSchemaAnchor(string calldata id) external view returns (SchemaAnchor memory) {
        return _schemas[id];
    }

    function getCredDefAnchor(string calldata id) external view returns (CredDefAnchor memory) {
        return _credDefs[id];
    }

    function isSchemaAnchored(string calldata id, bytes32 expectedHash) external view returns (bool) {
        SchemaAnchor memory a = _schemas[id];
        return a.issuer != address(0) && a.recordHash == expectedHash;
    }

    function isCredDefAnchored(string calldata id, bytes32 expectedHash) external view returns (bool) {
        CredDefAnchor memory a = _credDefs[id];
        return a.issuer != address(0) && a.recordHash == expectedHash;
    }
}
