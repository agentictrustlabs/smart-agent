// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentRelationshipTemplate
 * @notice Reusable DnS Descriptions mapping (relationshipType, role) pairs
 *         to permitted delegation patterns and caveat requirements.
 *
 * A template says:
 *   "When an agent holds role R in relationship type T,
 *    these are the delegation capabilities, required caveats, and constraints."
 *
 * Three layers:
 *   Relationship edge → states the fact ("Alice is CEO of Org X")
 *   Template          → states the normative model ("a CEO may spend up to X, sign Y, for Z time")
 *   Delegation        → states the executable grant (actual caveat-bound delegation instance)
 *
 * Templates are keyed by (relationshipType, role) and are reusable across
 * all relationship instances of that type/role combination.
 */
contract AgentRelationshipTemplate {
    struct CaveatRequirement {
        address enforcer;       // which caveat enforcer
        bool required;          // true = must be present, false = optional
        bytes defaultTerms;     // default encoded terms (empty if must be parameterized)
    }

    struct Template {
        uint256 templateId;
        bytes32 relationshipType;
        bytes32 role;
        string name;            // human-readable name (e.g., "Treasury Operator Authority")
        string description;     // what this template authorizes
        CaveatRequirement[] caveats;
        string delegationSchemaURI;  // off-chain schema for delegation parameters
        string metadataURI;          // additional metadata
        address createdBy;
        uint256 createdAt;
        bool active;
    }

    // ─── Storage ────────────────────────────────────────────────────

    Template[] private _templates;

    /// @dev (relationshipType, role) → templateIds
    mapping(bytes32 => mapping(bytes32 => uint256[])) private _byTypeAndRole;

    /// @dev templateId → caveat requirements (stored separately for struct limits)
    mapping(uint256 => CaveatRequirement[]) private _caveatRequirements;

    // ─── Events ─────────────────────────────────────────────────────

    event TemplateCreated(
        uint256 indexed templateId,
        bytes32 indexed relationshipType,
        bytes32 indexed role,
        string name,
        address createdBy
    );

    event TemplateDeactivated(uint256 indexed templateId);
    event TemplateActivated(uint256 indexed templateId);

    // ─── Errors ─────────────────────────────────────────────────────

    error TemplateNotFound();
    error NotAuthorized();

    // ─── Create ─────────────────────────────────────────────────────

    /**
     * @notice Create a reusable template for a (relationshipType, role) pair.
     */
    function createTemplate(
        bytes32 relationshipType,
        bytes32 role,
        string calldata name,
        string calldata templateDescription,
        CaveatRequirement[] calldata caveats,
        string calldata delegationSchemaURI,
        string calldata metadataURI
    ) external returns (uint256 templateId) {
        templateId = _templates.length;

        // Push empty template first (dynamic arrays can't be set in memory struct)
        _templates.push();
        Template storage t = _templates[templateId];
        t.templateId = templateId;
        t.relationshipType = relationshipType;
        t.role = role;
        t.name = name;
        t.description = templateDescription;
        t.delegationSchemaURI = delegationSchemaURI;
        t.metadataURI = metadataURI;
        t.createdBy = msg.sender;
        t.createdAt = block.timestamp;
        t.active = true;

        // Store caveat requirements
        for (uint256 i = 0; i < caveats.length; i++) {
            _caveatRequirements[templateId].push(caveats[i]);
        }

        _byTypeAndRole[relationshipType][role].push(templateId);

        emit TemplateCreated(templateId, relationshipType, role, name, msg.sender);
    }

    // ─── Status ─────────────────────────────────────────────────────

    function deactivateTemplate(uint256 templateId) external {
        if (templateId >= _templates.length) revert TemplateNotFound();
        Template storage t = _templates[templateId];
        if (msg.sender != t.createdBy) revert NotAuthorized();
        t.active = false;
        emit TemplateDeactivated(templateId);
    }

    function activateTemplate(uint256 templateId) external {
        if (templateId >= _templates.length) revert TemplateNotFound();
        Template storage t = _templates[templateId];
        if (msg.sender != t.createdBy) revert NotAuthorized();
        t.active = true;
        emit TemplateActivated(templateId);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getTemplate(uint256 templateId) external view returns (
        uint256 id_,
        bytes32 relationshipType,
        bytes32 role,
        string memory name,
        string memory templateDescription,
        string memory delegationSchemaURI,
        string memory metadataURI,
        address createdBy,
        uint256 createdAt,
        bool active
    ) {
        if (templateId >= _templates.length) revert TemplateNotFound();
        Template storage t = _templates[templateId];
        return (
            t.templateId, t.relationshipType, t.role,
            t.name, t.description,
            t.delegationSchemaURI, t.metadataURI,
            t.createdBy, t.createdAt, t.active
        );
    }

    function getCaveatRequirements(uint256 templateId) external view returns (CaveatRequirement[] memory) {
        if (templateId >= _templates.length) revert TemplateNotFound();
        return _caveatRequirements[templateId];
    }

    function getTemplatesByTypeAndRole(
        bytes32 relationshipType,
        bytes32 role
    ) external view returns (uint256[] memory) {
        return _byTypeAndRole[relationshipType][role];
    }

    function templateCount() external view returns (uint256) {
        return _templates.length;
    }
}
