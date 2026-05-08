// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

/**
 * @title PoolRegistry
 * @notice Pool body lives in this contract's own typed-attribute storage
 *         (inherited from AttributeStorage). Decoupled from any other
 *         contract — no shared backend.
 *
 * A Pool is an OrganizationAgent (sa:Pool subClassOf sa:OrganizationAgent),
 * so the subject id is the pool's agent address.
 *
 * Auth: pool's AgentAccount.isOwner(msg.sender) must be true. The registry
 * contract IS the only writer of its own state via the inherited internal
 * setters — no external auth surface.
 *
 * Aggregate counters (sa:poolPledgedTotal etc.) stay off-chain in org-mcp
 * per IA P4 § 8.2 — too high-frequency for the on-chain anchor.
 */
contract PoolRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_POOL = keccak256("sa:Pool");

    bytes32 public constant SA_POOL_DOMAIN            = keccak256("sa:poolDomain");
    bytes32 public constant SA_POOL_GOVERNANCE_MODEL  = keccak256("sa:poolGovernanceModel");
    bytes32 public constant SA_POOL_MANDATE_HASH      = keccak256("sa:poolMandateHash");
    bytes32 public constant SA_POOL_MANDATE_URI       = keccak256("sa:poolMandateURI");
    bytes32 public constant SA_POOL_ACCEPTED_UNITS    = keccak256("sa:poolAcceptedUnits");
    bytes32 public constant SA_POOL_ACCEPTED_KINDS    = keccak256("sa:poolAcceptedKinds");
    bytes32 public constant SA_POOL_CEILING_POLICY    = keccak256("sa:poolCeilingPolicy");
    bytes32 public constant SA_POOL_CAPACITY_CEILING  = keccak256("sa:poolCapacityCeiling");
    bytes32 public constant SA_POOL_STEWARDS          = keccak256("sa:poolStewards");
    bytes32 public constant SA_POOL_VISIBILITY        = keccak256("sa:poolVisibility");
    bytes32 public constant SA_POOL_OPENED_AT         = keccak256("sa:poolOpenedAt");
    bytes32 public constant SA_POOL_CLOSED_AT         = keccak256("sa:poolClosedAt");
    bytes32 public constant SA_POOL_ACCEPTED_RESTRICTIONS = keccak256("sa:poolAcceptedRestrictions");
    /** Off-chain pool slug (used to derive urn:smart-agent:pool:<slug> IRI). */
    bytes32 public constant SA_POOL_SLUG                  = keccak256("sa:poolSlug");

    error NotPoolOwner();

    event PoolOpened(address indexed poolAgent, bytes32 subject);
    event PoolClosed(address indexed poolAgent, bytes32 subject);
    event PoolMandateUpdated(address indexed poolAgent, bytes32 newMandateHash);
    event PoolStewardsRotated(address indexed poolAgent, uint256 stewardCount);

    struct OpenParams {
        address poolAgent;
        bytes32 domain;
        bytes32 governanceModel;
        bytes32 mandateHash;
        string  mandateURI;
        bytes32[] acceptedUnits;
        bytes32[] acceptedKinds;
        bytes32 ceilingPolicy;
        uint256 capacityCeiling;
        address[] stewards;
        bytes32 visibility;
        string  acceptedRestrictions;  // JSON; empty string means unset
        string  slug;                  // off-chain id; required for IRI derivation
    }

    modifier onlyPoolOwner(address poolAgent) {
        if (poolAgent.code.length == 0) revert NotPoolOwner();
        (bool ok, bytes memory data) = poolAgent.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        if (!ok || data.length < 32 || !abi.decode(data, (bool))) revert NotPoolOwner();
        _;
    }

    constructor(address ontologyRegistry, address shapes) AttributeStorage(ontologyRegistry) {
        SHAPES = ShapeRegistry(shapes);
    }

    function _subject(address poolAgent) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(poolAgent)));
    }

    function open(OpenParams calldata p) external onlyPoolOwner(p.poolAgent) {
        bytes32 s = _subject(p.poolAgent);

        _setBytes32(s, SA_POOL_DOMAIN, p.domain);
        _setBytes32(s, SA_POOL_GOVERNANCE_MODEL, p.governanceModel);
        _setBytes32(s, SA_POOL_MANDATE_HASH, p.mandateHash);
        if (bytes(p.mandateURI).length > 0) {
            _setString(s, SA_POOL_MANDATE_URI, p.mandateURI);
        }
        if (p.acceptedUnits.length > 0) {
            _setBytes32Arr(s, SA_POOL_ACCEPTED_UNITS, p.acceptedUnits);
        }
        _setBytes32Arr(s, SA_POOL_ACCEPTED_KINDS, p.acceptedKinds);
        _setBytes32(s, SA_POOL_CEILING_POLICY, p.ceilingPolicy);
        if (p.capacityCeiling > 0) {
            _setUint(s, SA_POOL_CAPACITY_CEILING, p.capacityCeiling);
        }
        _setAddressArr(s, SA_POOL_STEWARDS, p.stewards);
        _setBytes32(s, SA_POOL_VISIBILITY, p.visibility);
        _setUint(s, SA_POOL_OPENED_AT, block.timestamp);
        if (bytes(p.acceptedRestrictions).length > 0) {
            _setString(s, SA_POOL_ACCEPTED_RESTRICTIONS, p.acceptedRestrictions);
        }
        if (bytes(p.slug).length > 0) {
            _setString(s, SA_POOL_SLUG, p.slug);
        }

        SHAPES.validateSubject(CLASS_POOL, s, address(this));

        emit PoolOpened(p.poolAgent, s);
    }

    function close(address poolAgent) external onlyPoolOwner(poolAgent) {
        bytes32 s = _subject(poolAgent);
        _setUint(s, SA_POOL_CLOSED_AT, block.timestamp);
        emit PoolClosed(poolAgent, s);
    }

    function updateMandate(
        address poolAgent,
        bytes32 newMandateHash,
        string calldata newMandateURI
    ) external onlyPoolOwner(poolAgent) {
        bytes32 s = _subject(poolAgent);
        _setBytes32(s, SA_POOL_MANDATE_HASH, newMandateHash);
        if (bytes(newMandateURI).length > 0) {
            _setString(s, SA_POOL_MANDATE_URI, newMandateURI);
        }
        emit PoolMandateUpdated(poolAgent, newMandateHash);
    }

    function rotateStewards(
        address poolAgent,
        address[] calldata newStewards
    ) external onlyPoolOwner(poolAgent) {
        bytes32 s = _subject(poolAgent);
        _setAddressArr(s, SA_POOL_STEWARDS, newStewards);
        emit PoolStewardsRotated(poolAgent, newStewards.length);
    }

    function setAcceptedRestrictions(
        address poolAgent,
        string calldata restrictionsJson
    ) external onlyPoolOwner(poolAgent) {
        _setString(_subject(poolAgent), SA_POOL_ACCEPTED_RESTRICTIONS, restrictionsJson);
    }

    // ─── Convenience getters keyed by agent address ────────────────

    function getDomain(address poolAgent) external view returns (bytes32) {
        return this.getBytes32(_subject(poolAgent), SA_POOL_DOMAIN);
    }
    function getGovernanceModel(address poolAgent) external view returns (bytes32) {
        return this.getBytes32(_subject(poolAgent), SA_POOL_GOVERNANCE_MODEL);
    }
    function getMandate(address poolAgent) external view returns (bytes32 mandateHash, string memory mandateURI) {
        bytes32 s = _subject(poolAgent);
        mandateHash = this.getBytes32(s, SA_POOL_MANDATE_HASH);
        mandateURI = this.getString(s, SA_POOL_MANDATE_URI);
    }
    function getAcceptedKinds(address poolAgent) external view returns (bytes32[] memory) {
        return this.getBytes32Arr(_subject(poolAgent), SA_POOL_ACCEPTED_KINDS);
    }
    function getAcceptedUnits(address poolAgent) external view returns (bytes32[] memory) {
        return this.getBytes32Arr(_subject(poolAgent), SA_POOL_ACCEPTED_UNITS);
    }
    function getStewards(address poolAgent) external view returns (address[] memory) {
        return this.getAddressArr(_subject(poolAgent), SA_POOL_STEWARDS);
    }
    function getCeilingPolicy(address poolAgent) external view returns (bytes32) {
        return this.getBytes32(_subject(poolAgent), SA_POOL_CEILING_POLICY);
    }
    function getCapacityCeiling(address poolAgent) external view returns (uint256) {
        return this.getUint(_subject(poolAgent), SA_POOL_CAPACITY_CEILING);
    }
    function getVisibility(address poolAgent) external view returns (bytes32) {
        return this.getBytes32(_subject(poolAgent), SA_POOL_VISIBILITY);
    }
    function getOpenedAt(address poolAgent) external view returns (uint256) {
        return this.getUint(_subject(poolAgent), SA_POOL_OPENED_AT);
    }
    function getClosedAt(address poolAgent) external view returns (uint256) {
        return this.getUint(_subject(poolAgent), SA_POOL_CLOSED_AT);
    }
    function isOpen(address poolAgent) external view returns (bool) {
        bytes32 s = _subject(poolAgent);
        return this.isSet(s, SA_POOL_OPENED_AT) && !this.isSet(s, SA_POOL_CLOSED_AT);
    }
    function getAcceptedRestrictions(address poolAgent) external view returns (string memory) {
        return this.getString(_subject(poolAgent), SA_POOL_ACCEPTED_RESTRICTIONS);
    }
    function getPoolSlug(address poolAgent) external view returns (string memory) {
        return this.getString(_subject(poolAgent), SA_POOL_SLUG);
    }
}
