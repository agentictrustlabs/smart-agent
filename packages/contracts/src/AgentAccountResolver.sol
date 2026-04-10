// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyTermRegistry.sol";
import "./AgentPredicates.sol";

/**
 * @title AgentAccountResolver
 * @notice ENS-style resolver for agent metadata properties.
 *
 * Stores intrinsic, descriptive properties for each ERC-4337 agent account.
 * Properties are keyed by ontology-aligned predicates (bytes32 = keccak256 of CURIE).
 *
 * Authorization: only an owner of the agent (checked via AgentRootAccount.isOwner)
 * can set properties. The deployer/server signer is typically a co-owner.
 *
 * Core record: gas-optimized struct for the most common reads (name, type, metadata URI).
 * Generic store: predicate-based key/value for extensibility without redeployment.
 *
 * Off-chain: the metadataURI points to a JSON-LD document on IPFS that contains
 * the full semantic representation, validated by SHACL shapes.
 */
contract AgentAccountResolver {
    OntologyTermRegistry public immutable ONTOLOGY;

    // ─── Core Record ────────────────────────────────────────────────

    struct CoreRecord {
        string displayName;
        string description;
        bytes32 agentType;       // TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT
        bytes32 agentClass;      // CLASS_DISCOVERY, CLASS_VALIDATOR, etc. (for AI agents)
        string metadataURI;      // IPFS URI to JSON-LD document
        bytes32 metadataHash;    // keccak256 of the metadata document
        string schemaURI;        // URI to SHACL shape
        bool active;
        uint256 registeredAt;
        uint256 updatedAt;
    }

    mapping(address => CoreRecord) private _core;
    address[] private _agents;
    mapping(address => bool) private _registered;

    // ─── Generic Predicate Store ────────────────────────────────────

    mapping(address => mapping(bytes32 => string)) private _stringProps;
    mapping(address => mapping(bytes32 => address)) private _addressProps;
    mapping(address => mapping(bytes32 => bool)) private _boolProps;
    mapping(address => mapping(bytes32 => uint256)) private _uintProps;
    mapping(address => mapping(bytes32 => string[])) private _multiStringProps;
    mapping(address => mapping(bytes32 => address[])) private _multiAddressProps;

    // Track which predicates are set per agent for enumeration
    mapping(address => bytes32[]) private _predicateKeys;
    mapping(address => mapping(bytes32 => bool)) private _predicateSet;

    // ─── Events ─────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string displayName, bytes32 indexed agentType);
    event AgentUpdated(address indexed agent, uint256 updatedAt);
    event CoreUpdated(address indexed agent, string displayName, bytes32 agentType);
    event PropertySet(address indexed agent, bytes32 indexed predicate);
    event MultiPropertyAdded(address indexed agent, bytes32 indexed predicate, string value);
    event MetadataUpdated(address indexed agent, string metadataURI, bytes32 metadataHash);

    error NotAgentOwner();
    error AlreadyRegistered();
    error NotRegistered();
    error PredicateNotRegistered();

    // ─── Authorization ──────────────────────────────────────────────

    /**
     * @dev Check if msg.sender is an owner of the agent smart account.
     *      Calls AgentRootAccount.isOwner(msg.sender) on the agent address.
     */
    modifier onlyAgentOwner(address agent) {
        (bool ok, bytes memory data) = agent.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        if (!ok || !abi.decode(data, (bool))) revert NotAgentOwner();
        _;
    }

    modifier onlyRegistered(address agent) {
        if (!_registered[agent]) revert NotRegistered();
        _;
    }

    modifier validPredicate(bytes32 predicate) {
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotRegistered();
        _;
    }

    constructor(address ontologyRegistry) {
        ONTOLOGY = OntologyTermRegistry(ontologyRegistry);
    }

    // ─── Registration ───────────────────────────────────────────────

    /**
     * @notice Register an agent with core metadata. Can only be called once per agent.
     */
    function register(
        address agent,
        string calldata displayName,
        string calldata description,
        bytes32 agentType,
        bytes32 agentClass,
        string calldata schemaURI
    ) external onlyAgentOwner(agent) {
        if (_registered[agent]) revert AlreadyRegistered();

        _core[agent] = CoreRecord({
            displayName: displayName,
            description: description,
            agentType: agentType,
            agentClass: agentClass,
            metadataURI: "",
            metadataHash: bytes32(0),
            schemaURI: schemaURI,
            active: true,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp
        });

        _registered[agent] = true;
        _agents.push(agent);

        emit AgentRegistered(agent, displayName, agentType);
    }

    // ─── Core Property Setters ──────────────────────────────────────

    function updateCore(
        address agent,
        string calldata displayName,
        string calldata description,
        bytes32 agentType,
        bytes32 agentClass
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        CoreRecord storage c = _core[agent];
        c.displayName = displayName;
        c.description = description;
        c.agentType = agentType;
        c.agentClass = agentClass;
        c.updatedAt = block.timestamp;
        emit CoreUpdated(agent, displayName, agentType);
    }

    function setActive(address agent, bool active) external onlyAgentOwner(agent) onlyRegistered(agent) {
        _core[agent].active = active;
        _core[agent].updatedAt = block.timestamp;
        emit AgentUpdated(agent, block.timestamp);
    }

    function setMetadataURI(
        address agent,
        string calldata uri,
        bytes32 hash
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        _core[agent].metadataURI = uri;
        _core[agent].metadataHash = hash;
        _core[agent].updatedAt = block.timestamp;
        emit MetadataUpdated(agent, uri, hash);
    }

    function setSchemaURI(
        address agent,
        string calldata uri
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        _core[agent].schemaURI = uri;
        _core[agent].updatedAt = block.timestamp;
    }

    // ─── Generic Property Setters ───────────────────────────────────

    function setStringProperty(
        address agent, bytes32 predicate, string calldata value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        _stringProps[agent][predicate] = value;
        _trackPredicate(agent, predicate);
        emit PropertySet(agent, predicate);
    }

    function setAddressProperty(
        address agent, bytes32 predicate, address value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        _addressProps[agent][predicate] = value;
        _trackPredicate(agent, predicate);
        emit PropertySet(agent, predicate);
    }

    function setBoolProperty(
        address agent, bytes32 predicate, bool value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        _boolProps[agent][predicate] = value;
        _trackPredicate(agent, predicate);
        emit PropertySet(agent, predicate);
    }

    function setUintProperty(
        address agent, bytes32 predicate, uint256 value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        _uintProps[agent][predicate] = value;
        _trackPredicate(agent, predicate);
        emit PropertySet(agent, predicate);
    }

    function addMultiStringProperty(
        address agent, bytes32 predicate, string calldata value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        _multiStringProps[agent][predicate].push(value);
        _trackPredicate(agent, predicate);
        emit MultiPropertyAdded(agent, predicate, value);
    }

    function clearMultiStringProperty(
        address agent, bytes32 predicate
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        delete _multiStringProps[agent][predicate];
        emit PropertySet(agent, predicate);
    }

    function addMultiAddressProperty(
        address agent, bytes32 predicate, address value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        _multiAddressProps[agent][predicate].push(value);
        _trackPredicate(agent, predicate);
    }

    function clearMultiAddressProperty(
        address agent, bytes32 predicate
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        delete _multiAddressProps[agent][predicate];
    }

    // ─── Readers ────────────────────────────────────────────────────

    function getCore(address agent) external view returns (CoreRecord memory) {
        return _core[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _registered[agent];
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function getAgentAt(uint256 index) external view returns (address) {
        return _agents[index];
    }

    function getAllAgents() external view returns (address[] memory) {
        return _agents;
    }

    function getStringProperty(address agent, bytes32 predicate) external view returns (string memory) {
        return _stringProps[agent][predicate];
    }

    function getAddressProperty(address agent, bytes32 predicate) external view returns (address) {
        return _addressProps[agent][predicate];
    }

    function getBoolProperty(address agent, bytes32 predicate) external view returns (bool) {
        return _boolProps[agent][predicate];
    }

    function getUintProperty(address agent, bytes32 predicate) external view returns (uint256) {
        return _uintProps[agent][predicate];
    }

    function getMultiStringProperty(address agent, bytes32 predicate) external view returns (string[] memory) {
        return _multiStringProps[agent][predicate];
    }

    function getMultiAddressProperty(address agent, bytes32 predicate) external view returns (address[] memory) {
        return _multiAddressProps[agent][predicate];
    }

    function getPredicateKeys(address agent) external view returns (bytes32[] memory) {
        return _predicateKeys[agent];
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _trackPredicate(address agent, bytes32 predicate) internal {
        if (!_predicateSet[agent][predicate]) {
            _predicateKeys[agent].push(predicate);
            _predicateSet[agent][predicate] = true;
        }
    }
}
