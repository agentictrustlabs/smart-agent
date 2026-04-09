// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentRelationship
 * @notice Canonical relationship edge store between ERC-4337 agent accounts.
 *
 * One edge per (subject, object, relationshipType) triple.
 * Each edge carries a set of roles the subject plays within that relationship.
 *
 * DOLCE+DnS mapping:
 * - An edge is a Situation: a concrete state of affairs
 * - relationshipType is the DnS Description (normative context)
 * - roles are the parts the subject plays within that situation
 * - subject / object are social agents (4337 accounts, did:ethr)
 */
contract AgentRelationship {
    enum EdgeStatus {
        NONE,
        PROPOSED,
        CONFIRMED,
        ACTIVE,
        SUSPENDED,
        REVOKED,
        REJECTED
    }

    struct Edge {
        bytes32 edgeId;
        address subject;
        address object_;
        bytes32 relationshipType;
        EdgeStatus status;
        address createdBy;
        uint256 createdAt;
        uint256 updatedAt;
        string metadataURI;
    }

    // ─── Well-Known Relationship Types ──────────────────────────────
    // A. Governance / Control
    bytes32 public constant ORGANIZATION_GOVERNANCE = keccak256("OrganizationGovernance");
    // B. Membership / Institutional
    bytes32 public constant ORGANIZATION_MEMBERSHIP = keccak256("OrganizationMembership");
    bytes32 public constant ALLIANCE = keccak256("Alliance");
    // C. Assurance / Validation
    bytes32 public constant VALIDATION_TRUST = keccak256("ValidationTrust");
    bytes32 public constant INSURANCE_COVERAGE = keccak256("InsuranceCoverage");
    bytes32 public constant COMPLIANCE = keccak256("Compliance");
    // D. Economic Security
    bytes32 public constant ECONOMIC_SECURITY = keccak256("EconomicSecurity");
    // E. Service / Execution
    bytes32 public constant SERVICE_AGREEMENT = keccak256("ServiceAgreement");
    bytes32 public constant DELEGATION_AUTHORITY = keccak256("DelegationAuthority");
    // F. Runtime / TEE
    bytes32 public constant RUNTIME_ATTESTATION = keccak256("RuntimeAttestation");
    bytes32 public constant BUILD_PROVENANCE = keccak256("BuildProvenance");
    // G. Organizational Control
    bytes32 public constant ORGANIZATIONAL_CONTROL = keccak256("OrganizationalControl");
    // H. Activity Validation
    bytes32 public constant ACTIVITY_VALIDATION = keccak256("ActivityValidation");
    // I. Reviews
    bytes32 public constant REVIEW_RELATIONSHIP = keccak256("ReviewRelationship");

    // ─── Well-Known Roles ───────────────────────────────────────────
    // Governance
    bytes32 public constant ROLE_OWNER = keccak256("owner");
    bytes32 public constant ROLE_BOARD_MEMBER = keccak256("board-member");
    bytes32 public constant ROLE_CEO = keccak256("ceo");
    bytes32 public constant ROLE_EXECUTIVE = keccak256("executive");
    bytes32 public constant ROLE_TREASURER = keccak256("treasurer");
    bytes32 public constant ROLE_AUTHORIZED_SIGNER = keccak256("authorized-signer");
    bytes32 public constant ROLE_OFFICER = keccak256("officer");
    bytes32 public constant ROLE_CHAIR = keccak256("chair");
    bytes32 public constant ROLE_ADVISOR = keccak256("advisor");
    // Membership
    bytes32 public constant ROLE_ADMIN = keccak256("admin");
    bytes32 public constant ROLE_MEMBER = keccak256("member");
    bytes32 public constant ROLE_OPERATOR = keccak256("operator");
    bytes32 public constant ROLE_EMPLOYEE = keccak256("employee");
    bytes32 public constant ROLE_CONTRACTOR = keccak256("contractor");
    // Assurance
    bytes32 public constant ROLE_AUDITOR = keccak256("auditor");
    bytes32 public constant ROLE_VALIDATOR = keccak256("validator");
    bytes32 public constant ROLE_INSURER = keccak256("insurer");
    bytes32 public constant ROLE_INSURED_PARTY = keccak256("insured-party");
    bytes32 public constant ROLE_UNDERWRITER = keccak256("underwriter");
    bytes32 public constant ROLE_CERTIFIED_BY = keccak256("certified-by");
    bytes32 public constant ROLE_LICENSED_BY = keccak256("licensed-by");
    // Economic
    bytes32 public constant ROLE_STAKER = keccak256("staker");
    bytes32 public constant ROLE_GUARANTOR = keccak256("guarantor");
    bytes32 public constant ROLE_BACKER = keccak256("backer");
    bytes32 public constant ROLE_COLLATERAL_PROVIDER = keccak256("collateral-provider");
    // Alliance
    bytes32 public constant ROLE_STRATEGIC_PARTNER = keccak256("strategic-partner");
    bytes32 public constant ROLE_AFFILIATE = keccak256("affiliate");
    bytes32 public constant ROLE_ENDORSED_BY = keccak256("endorsed-by");
    bytes32 public constant ROLE_SUBSIDIARY = keccak256("subsidiary");
    bytes32 public constant ROLE_PARENT_ORG = keccak256("parent-org");
    // Service
    bytes32 public constant ROLE_VENDOR = keccak256("vendor");
    bytes32 public constant ROLE_SERVICE_PROVIDER = keccak256("service-provider");
    bytes32 public constant ROLE_DELEGATED_OPERATOR = keccak256("delegated-operator");
    // TEE / Runtime
    bytes32 public constant ROLE_RUNS_IN_TEE = keccak256("runs-in-tee");
    bytes32 public constant ROLE_ATTESTED_BY = keccak256("attested-by");
    bytes32 public constant ROLE_VERIFIED_BY = keccak256("verified-by");
    bytes32 public constant ROLE_BOUND_TO_KMS = keccak256("bound-to-kms");
    bytes32 public constant ROLE_CONTROLS_RUNTIME = keccak256("controls-runtime");
    bytes32 public constant ROLE_BUILT_FROM = keccak256("built-from");
    bytes32 public constant ROLE_DEPLOYED_FROM = keccak256("deployed-from");
    // Organizational Control
    bytes32 public constant ROLE_OPERATED_AGENT = keccak256("operated-agent");
    bytes32 public constant ROLE_MANAGED_AGENT = keccak256("managed-agent");
    bytes32 public constant ROLE_ADMINISTERS = keccak256("administers");
    // Activity Validation
    bytes32 public constant ROLE_ACTIVITY_VALIDATOR = keccak256("activity-validator");
    bytes32 public constant ROLE_VALIDATED_PERFORMER = keccak256("validated-performer");
    // Reviews
    bytes32 public constant ROLE_REVIEWER = keccak256("reviewer");
    bytes32 public constant ROLE_REVIEWED_AGENT = keccak256("reviewed-agent");

    // ─── Storage ────────────────────────────────────────────────────

    mapping(bytes32 => Edge) private _edges;
    /// @dev edgeId → set of roles
    mapping(bytes32 => bytes32[]) private _roles;
    /// @dev edgeId → role → exists
    mapping(bytes32 => mapping(bytes32 => bool)) private _hasRole;

    mapping(address => bytes32[]) private _edgesBySubject;
    mapping(address => bytes32[]) private _edgesByObject;
    mapping(address => mapping(address => mapping(bytes32 => bytes32))) private _byTriple;

    // ─── Events ─────────────────────────────────────────────────────

    event EdgeCreated(
        bytes32 indexed edgeId,
        address indexed subject,
        address indexed object_,
        bytes32 relationshipType,
        address createdBy
    );

    event RoleAdded(bytes32 indexed edgeId, bytes32 indexed role, address indexed updater);
    event RoleRemoved(bytes32 indexed edgeId, bytes32 indexed role, address indexed updater);
    event EdgeStatusUpdated(bytes32 indexed edgeId, EdgeStatus status, address indexed updater);
    event EdgeMetadataUpdated(bytes32 indexed edgeId, string metadataURI, address indexed updater);

    // ─── Events (confirmation) ────────────────────────────────────────

    event EdgeConfirmed(bytes32 indexed edgeId, address indexed confirmedBy);
    event EdgeRejected(bytes32 indexed edgeId, address indexed rejectedBy);

    // ─── Errors ─────────────────────────────────────────────────────

    error InvalidEdge();
    error EdgeAlreadyExists();
    error EdgeNotFound();
    error RoleAlreadyExists();
    error RoleNotFound();
    error NotAuthorized();
    error InvalidTransition();

    // ─── Edge ID ────────────────────────────────────────────────────

    /// @notice Canonical edge ID = keccak256(subject, object, relationshipType)
    ///         One edge per triple. Roles are a set on the edge.
    function computeEdgeId(
        address subject,
        address object_,
        bytes32 relationshipType
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(subject, object_, relationshipType));
    }

    // ─── Create ─────────────────────────────────────────────────────

    /// @notice Create a relationship edge. Optionally include initial roles.
    function createEdge(
        address subject,
        address object_,
        bytes32 relationshipType,
        bytes32[] calldata initialRoles,
        string calldata metadataURI
    ) external returns (bytes32 edgeId) {
        if (subject == address(0) || object_ == address(0)) revert InvalidEdge();

        edgeId = computeEdgeId(subject, object_, relationshipType);
        if (_edges[edgeId].createdAt != 0) revert EdgeAlreadyExists();

        _edges[edgeId] = Edge({
            edgeId: edgeId,
            subject: subject,
            object_: object_,
            relationshipType: relationshipType,
            status: EdgeStatus.PROPOSED,
            createdBy: msg.sender,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            metadataURI: metadataURI
        });

        _edgesBySubject[subject].push(edgeId);
        _edgesByObject[object_].push(edgeId);
        _byTriple[subject][object_][relationshipType] = edgeId;

        // Add initial roles
        for (uint256 i = 0; i < initialRoles.length; i++) {
            _addRole(edgeId, initialRoles[i]);
            emit RoleAdded(edgeId, initialRoles[i], msg.sender);
        }

        emit EdgeCreated(edgeId, subject, object_, relationshipType, msg.sender);
    }

    // ─── Roles ──────────────────────────────────────────────────────

    /// @notice Add a role to an existing edge.
    function addRole(bytes32 edgeId, bytes32 role) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        _requireAuth(e);
        if (_hasRole[edgeId][role]) revert RoleAlreadyExists();

        _addRole(edgeId, role);
        e.updatedAt = block.timestamp;
        emit RoleAdded(edgeId, role, msg.sender);
    }

    /// @notice Remove a role from an edge.
    function removeRole(bytes32 edgeId, bytes32 role) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        _requireAuth(e);
        if (!_hasRole[edgeId][role]) revert RoleNotFound();

        _removeRole(edgeId, role);
        e.updatedAt = block.timestamp;
        emit RoleRemoved(edgeId, role, msg.sender);
    }

    // ─── Status ─────────────────────────────────────────────────────

    function setEdgeStatus(bytes32 edgeId, EdgeStatus newStatus) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        _requireAuth(e);

        e.status = newStatus;
        e.updatedAt = block.timestamp;
        emit EdgeStatusUpdated(edgeId, newStatus, msg.sender);
    }

    /**
     * @notice Counterparty confirms a PROPOSED relationship.
     *         Only the object side (or its owner via isOwner) can confirm.
     *         PROPOSED → CONFIRMED. Resolver later promotes to ACTIVE.
     */
    function confirmEdge(bytes32 edgeId) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (e.status != EdgeStatus.PROPOSED) revert InvalidTransition();
        _requireObjectAuth(e);

        e.status = EdgeStatus.CONFIRMED;
        e.updatedAt = block.timestamp;
        emit EdgeConfirmed(edgeId, msg.sender);
    }

    /**
     * @notice Counterparty rejects a PROPOSED relationship.
     *         Only the object side can reject.
     */
    function rejectEdge(bytes32 edgeId) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (e.status != EdgeStatus.PROPOSED) revert InvalidTransition();
        _requireObjectAuth(e);

        e.status = EdgeStatus.REJECTED;
        e.updatedAt = block.timestamp;
        emit EdgeRejected(edgeId, msg.sender);
    }

    /**
     * @notice Activate a CONFIRMED edge. Called after resolver checks pass.
     *         Either party or deployer can activate.
     */
    function activateEdge(bytes32 edgeId) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        if (e.status != EdgeStatus.CONFIRMED) revert InvalidTransition();
        _requireAuth(e);

        e.status = EdgeStatus.ACTIVE;
        e.updatedAt = block.timestamp;
        emit EdgeStatusUpdated(edgeId, EdgeStatus.ACTIVE, msg.sender);
    }

    // ─── Metadata ───────────────────────────────────────────────────

    function setMetadataURI(bytes32 edgeId, string calldata metadataURI) external {
        Edge storage e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        _requireAuth(e);

        e.metadataURI = metadataURI;
        e.updatedAt = block.timestamp;
        emit EdgeMetadataUpdated(edgeId, metadataURI, msg.sender);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getEdge(bytes32 edgeId) external view returns (Edge memory) {
        Edge memory e = _edges[edgeId];
        if (e.createdAt == 0) revert EdgeNotFound();
        return e;
    }

    function getRoles(bytes32 edgeId) external view returns (bytes32[] memory) {
        return _roles[edgeId];
    }

    function hasRole(bytes32 edgeId, bytes32 role) external view returns (bool) {
        return _hasRole[edgeId][role];
    }

    function getEdgesBySubject(address subject) external view returns (bytes32[] memory) {
        return _edgesBySubject[subject];
    }

    function getEdgesByObject(address object_) external view returns (bytes32[] memory) {
        return _edgesByObject[object_];
    }

    /// @notice Get the single edge for a subject-object-relationshipType triple.
    function getEdgeByTriple(
        address subject,
        address object_,
        bytes32 relationshipType
    ) external view returns (bytes32) {
        return _byTriple[subject][object_][relationshipType];
    }

    function edgeExists(bytes32 edgeId) external view returns (bool) {
        return _edges[edgeId].createdAt != 0;
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _addRole(bytes32 edgeId, bytes32 role) internal {
        _roles[edgeId].push(role);
        _hasRole[edgeId][role] = true;
    }

    function _removeRole(bytes32 edgeId, bytes32 role) internal {
        _hasRole[edgeId][role] = false;
        bytes32[] storage roles = _roles[edgeId];
        for (uint256 i = 0; i < roles.length; i++) {
            if (roles[i] == role) {
                roles[i] = roles[roles.length - 1];
                roles.pop();
                break;
            }
        }
    }

    function _requireAuth(Edge storage e) internal view {
        if (msg.sender != e.subject && msg.sender != e.object_ && msg.sender != e.createdBy) {
            revert NotAuthorized();
        }
    }

    /// @dev Only the object agent or its owner can call.
    function _requireObjectAuth(Edge storage e) internal view {
        if (msg.sender == e.object_) return;

        // Check if caller is an owner of the object (4337 account)
        if (e.object_.code.length > 0) {
            (bool success, bytes memory result) = e.object_.staticcall(
                abi.encodeWithSignature("isOwner(address)", msg.sender)
            );
            if (success && result.length >= 32 && abi.decode(result, (bool))) return;
        }

        revert NotAuthorized();
    }
}
