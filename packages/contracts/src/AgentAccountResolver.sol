// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyTermRegistry.sol";
import "./OntologyAttributeStore.sol";
import "./AgentPredicates.sol";

/**
 * @title AgentAccountResolver
 * @notice ENS-style resolver for agent metadata. Phase 0.1: thin shim over
 *         OntologyAttributeStore. External API preserved; storage routes
 *         through the shared attribute store.
 *
 * Subject id for an agent is `bytes32(uint256(uint160(agent)))`. The resolver
 * is registered as a trustedWriter on AttributeAuth so authorized owner-mediated
 * writes pass through to the store.
 */
contract AgentAccountResolver {
    OntologyTermRegistry public immutable ONTOLOGY;
    OntologyAttributeStore public immutable STORE;

    struct CoreRecord {
        string displayName;
        string description;
        bytes32 agentType;
        bytes32 agentClass;
        string metadataURI;
        bytes32 metadataHash;
        string schemaURI;
        bool active;
        uint256 registeredAt;
        uint256 updatedAt;     // returns subjectVersion (monotonic counter)
    }

    address[] private _agents;
    mapping(address => bool) private _registered;

    bytes32 internal constant ATL_REGISTERED_AT = keccak256("atl:registeredAt");

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

    constructor(address ontologyRegistry, address attributeStore) {
        ONTOLOGY = OntologyTermRegistry(ontologyRegistry);
        STORE = OntologyAttributeStore(attributeStore);
    }

    // ─── Internal helpers ───────────────────────────────────────────

    function _subject(address agent) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(agent)));
    }

    // ─── Registration ───────────────────────────────────────────────

    function register(
        address agent,
        string calldata displayName,
        string calldata description,
        bytes32 agentType,
        bytes32 agentClass,
        string calldata schemaURI
    ) external onlyAgentOwner(agent) {
        if (_registered[agent]) revert AlreadyRegistered();

        bytes32 s = _subject(agent);
        STORE.setString(s, AgentPredicates.ATL_DISPLAY_NAME, displayName);
        if (bytes(description).length > 0) {
            STORE.setString(s, AgentPredicates.ATL_DESCRIPTION, description);
        }
        if (agentType != bytes32(0)) {
            STORE.setBytes32(s, AgentPredicates.ATL_AGENT_TYPE, agentType);
        }
        if (agentClass != bytes32(0)) {
            STORE.setBytes32(s, AgentPredicates.ATL_AI_AGENT_CLASS, agentClass);
        }
        if (bytes(schemaURI).length > 0) {
            STORE.setString(s, AgentPredicates.ATL_SCHEMA_URI, schemaURI);
        }
        STORE.setBool(s, AgentPredicates.ATL_IS_ACTIVE, true);
        STORE.setUint(s, ATL_REGISTERED_AT, block.timestamp);

        _registered[agent] = true;
        _agents.push(agent);

        emit AgentRegistered(agent, displayName, agentType);
    }

    // ─── Core property setters ──────────────────────────────────────

    function updateCore(
        address agent,
        string calldata displayName,
        string calldata description,
        bytes32 agentType,
        bytes32 agentClass
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        bytes32 s = _subject(agent);
        STORE.setString(s, AgentPredicates.ATL_DISPLAY_NAME, displayName);
        STORE.setString(s, AgentPredicates.ATL_DESCRIPTION, description);
        STORE.setBytes32(s, AgentPredicates.ATL_AGENT_TYPE, agentType);
        STORE.setBytes32(s, AgentPredicates.ATL_AI_AGENT_CLASS, agentClass);
        emit CoreUpdated(agent, displayName, agentType);
    }

    function setActive(address agent, bool active) external onlyAgentOwner(agent) onlyRegistered(agent) {
        STORE.setBool(_subject(agent), AgentPredicates.ATL_IS_ACTIVE, active);
        emit AgentUpdated(agent, block.timestamp);
    }

    function setMetadataURI(
        address agent,
        string calldata uri,
        bytes32 hash
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        bytes32 s = _subject(agent);
        STORE.setString(s, AgentPredicates.ATL_METADATA_URI, uri);
        STORE.setBytes32(s, AgentPredicates.ATL_METADATA_HASH, hash);
        emit MetadataUpdated(agent, uri, hash);
    }

    function setSchemaURI(
        address agent,
        string calldata uri
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        STORE.setString(_subject(agent), AgentPredicates.ATL_SCHEMA_URI, uri);
    }

    // ─── Generic property setters ───────────────────────────────────

    function setStringProperty(
        address agent, bytes32 predicate, string calldata value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        STORE.setString(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setAddressProperty(
        address agent, bytes32 predicate, address value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        STORE.setAddress(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setBoolProperty(
        address agent, bytes32 predicate, bool value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        STORE.setBool(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function setUintProperty(
        address agent, bytes32 predicate, uint256 value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        STORE.setUint(_subject(agent), predicate, value);
        emit PropertySet(agent, predicate);
    }

    function addMultiStringProperty(
        address agent, bytes32 predicate, string calldata value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        STORE.appendString(_subject(agent), predicate, value);
        emit MultiPropertyAdded(agent, predicate, value);
    }

    function clearMultiStringProperty(
        address agent, bytes32 predicate
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        string[] memory empty = new string[](0);
        STORE.setStringArr(_subject(agent), predicate, empty);
        emit PropertySet(agent, predicate);
    }

    function addMultiAddressProperty(
        address agent, bytes32 predicate, address value
    ) external onlyAgentOwner(agent) onlyRegistered(agent) validPredicate(predicate) {
        STORE.appendAddress(_subject(agent), predicate, value);
    }

    function clearMultiAddressProperty(
        address agent, bytes32 predicate
    ) external onlyAgentOwner(agent) onlyRegistered(agent) {
        address[] memory empty = new address[](0);
        STORE.setAddressArr(_subject(agent), predicate, empty);
    }

    // ─── Readers ────────────────────────────────────────────────────

    function getCore(address agent) external view returns (CoreRecord memory c) {
        bytes32 s = _subject(agent);
        c.displayName  = STORE.getString(s, AgentPredicates.ATL_DISPLAY_NAME);
        c.description  = STORE.getString(s, AgentPredicates.ATL_DESCRIPTION);
        c.agentType    = STORE.getBytes32(s, AgentPredicates.ATL_AGENT_TYPE);
        c.agentClass   = STORE.getBytes32(s, AgentPredicates.ATL_AI_AGENT_CLASS);
        c.metadataURI  = STORE.getString(s, AgentPredicates.ATL_METADATA_URI);
        c.metadataHash = STORE.getBytes32(s, AgentPredicates.ATL_METADATA_HASH);
        c.schemaURI    = STORE.getString(s, AgentPredicates.ATL_SCHEMA_URI);
        c.active       = STORE.getBool(s, AgentPredicates.ATL_IS_ACTIVE);
        c.registeredAt = STORE.getUint(s, ATL_REGISTERED_AT);
        c.updatedAt    = uint256(STORE.subjectVersion(s));
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
        return STORE.getString(_subject(agent), predicate);
    }

    function getAddressProperty(address agent, bytes32 predicate) external view returns (address) {
        return STORE.getAddress(_subject(agent), predicate);
    }

    function getBoolProperty(address agent, bytes32 predicate) external view returns (bool) {
        return STORE.getBool(_subject(agent), predicate);
    }

    function getUintProperty(address agent, bytes32 predicate) external view returns (uint256) {
        return STORE.getUint(_subject(agent), predicate);
    }

    function getMultiStringProperty(address agent, bytes32 predicate) external view returns (string[] memory) {
        return STORE.getStringArr(_subject(agent), predicate);
    }

    function getMultiAddressProperty(address agent, bytes32 predicate) external view returns (address[] memory) {
        return STORE.getAddressArr(_subject(agent), predicate);
    }

    function getPredicateKeys(address agent) external view returns (bytes32[] memory) {
        return STORE.predicatesOf(_subject(agent));
    }
}
