// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentIssuerProfile
 * @notice Registers claim issuers with their type, supported claim types,
 *         and validation methods.
 *
 * An issuer is an agent account that is authorized to make assertions
 * about other agents. Different issuer types carry different authority:
 * - A validator can verify identity
 * - An insurer can attest coverage
 * - A TEE verifier can attest runtime measurements
 * - A staking pool can attest economic security
 */
contract AgentIssuerProfile {
    // ─── Issuer Types ───────────────────────────────────────────────

    bytes32 public constant ISSUER_SELF = keccak256("self");
    bytes32 public constant ISSUER_COUNTERPARTY = keccak256("counterparty");
    bytes32 public constant ISSUER_ORGANIZATION = keccak256("organization");
    bytes32 public constant ISSUER_VALIDATOR = keccak256("validator");
    bytes32 public constant ISSUER_INSURER = keccak256("insurer");
    bytes32 public constant ISSUER_AUDITOR = keccak256("auditor");
    bytes32 public constant ISSUER_TEE_VERIFIER = keccak256("tee-verifier");
    bytes32 public constant ISSUER_STAKING_POOL = keccak256("staking-pool");
    bytes32 public constant ISSUER_GOVERNANCE = keccak256("governance");
    bytes32 public constant ISSUER_ORACLE = keccak256("oracle");

    // ─── Validation Methods ─────────────────────────────────────────

    bytes32 public constant VM_SELF_ASSERTED = keccak256("self-asserted");
    bytes32 public constant VM_COUNTERPARTY_CONFIRMED = keccak256("counterparty-confirmed");
    bytes32 public constant VM_MUTUALLY_CONFIRMED = keccak256("mutually-confirmed");
    bytes32 public constant VM_VALIDATOR_VERIFIED = keccak256("validator-verified");
    bytes32 public constant VM_INSURER_ISSUED = keccak256("insurer-issued");
    bytes32 public constant VM_TEE_ONCHAIN_VERIFIED = keccak256("tee-onchain-verified");
    bytes32 public constant VM_TEE_OFFCHAIN_AGGREGATED = keccak256("tee-offchain-aggregated");
    bytes32 public constant VM_ZK_VERIFIED = keccak256("zk-verified");
    bytes32 public constant VM_REPRODUCIBLE_BUILD = keccak256("reproducible-build");
    bytes32 public constant VM_GOVERNANCE_APPROVED = keccak256("governance-approved");
    bytes32 public constant VM_ORACLE_ATTESTED = keccak256("oracle-attested");

    // ─── Storage ────────────────────────────────────────────────────

    struct IssuerProfile {
        address issuer;           // the issuer's agent account
        bytes32 issuerType;       // ISSUER_VALIDATOR, ISSUER_INSURER, etc.
        string name;              // human-readable name
        string description;
        bytes32[] validationMethods;  // methods this issuer supports
        bytes32[] claimTypes;     // relationship types this issuer can assert about
        string metadataURI;
        uint256 registeredAt;
        bool active;
    }

    mapping(address => IssuerProfile) private _profiles;
    address[] private _issuers;
    mapping(bytes32 => address[]) private _issuersByType;

    // ─── Events ─────────────────────────────────────────────────────

    event IssuerRegistered(address indexed issuer, bytes32 indexed issuerType, string name);
    event IssuerDeactivated(address indexed issuer);
    event IssuerActivated(address indexed issuer);

    error AlreadyRegistered();
    error NotRegistered();
    error NotAuthorized();

    // ─── Register ───────────────────────────────────────────────────

    function registerIssuer(
        address issuer,
        bytes32 issuerType,
        string calldata name,
        string calldata description,
        bytes32[] calldata validationMethods,
        bytes32[] calldata claimTypes,
        string calldata metadataURI
    ) external {
        if (_profiles[issuer].registeredAt != 0) revert AlreadyRegistered();

        _profiles[issuer] = IssuerProfile({
            issuer: issuer,
            issuerType: issuerType,
            name: name,
            description: description,
            validationMethods: validationMethods,
            claimTypes: claimTypes,
            metadataURI: metadataURI,
            registeredAt: block.timestamp,
            active: true
        });

        _issuers.push(issuer);
        _issuersByType[issuerType].push(issuer);

        emit IssuerRegistered(issuer, issuerType, name);
    }

    function deactivateIssuer(address issuer) external {
        if (_profiles[issuer].registeredAt == 0) revert NotRegistered();
        if (msg.sender != issuer && msg.sender != _profiles[issuer].issuer) revert NotAuthorized();
        _profiles[issuer].active = false;
        emit IssuerDeactivated(issuer);
    }

    function activateIssuer(address issuer) external {
        if (_profiles[issuer].registeredAt == 0) revert NotRegistered();
        if (msg.sender != issuer) revert NotAuthorized();
        _profiles[issuer].active = true;
        emit IssuerActivated(issuer);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getProfile(address issuer) external view returns (
        address issuer_,
        bytes32 issuerType,
        string memory name,
        string memory description,
        string memory metadataURI,
        uint256 registeredAt,
        bool active
    ) {
        IssuerProfile storage p = _profiles[issuer];
        if (p.registeredAt == 0) revert NotRegistered();
        return (p.issuer, p.issuerType, p.name, p.description, p.metadataURI, p.registeredAt, p.active);
    }

    function getValidationMethods(address issuer) external view returns (bytes32[] memory) {
        return _profiles[issuer].validationMethods;
    }

    function getClaimTypes(address issuer) external view returns (bytes32[] memory) {
        return _profiles[issuer].claimTypes;
    }

    function isRegistered(address issuer) external view returns (bool) {
        return _profiles[issuer].registeredAt != 0;
    }

    function isActive(address issuer) external view returns (bool) {
        return _profiles[issuer].active;
    }

    function getIssuersByType(bytes32 issuerType) external view returns (address[] memory) {
        return _issuersByType[issuerType];
    }

    function issuerCount() external view returns (uint256) {
        return _issuers.length;
    }

    function getIssuerAt(uint256 index) external view returns (address) {
        return _issuers[index];
    }
}
