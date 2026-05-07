// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyAttributeStore.sol";
import "./ShapeRegistry.sol";

/**
 * @title PoolRegistry
 * @notice Phase 0.3 — pool body on chain via the shared attribute store.
 *
 * A Pool is an OrganizationAgent (sa:Pool subClassOf sa:OrganizationAgent),
 * so the subject id is the pool's agent address. Pool-specific predicates
 * coexist with agent-level predicates on the same subject.
 *
 * Aggregate counters (sa:poolPledgedTotal / sa:poolAllocatedTotal /
 * sa:poolAvailableTotal) stay off-chain in org-mcp as a debounced cache —
 * mutations are too frequent for the on-chain audit anchor; the public
 * mirror is emitted as event-style PoolPledgedTotal assertions at
 * minute-granularity.
 *
 * Auth: pool's AgentAccount.isOwner(msg.sender) must be true. The registry
 * is registered as a trustedWriter on AttributeAuth so its store writes
 * pass through.
 */
contract PoolRegistry {
    OntologyAttributeStore public immutable STORE;
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

    error NotPoolOwner();

    event PoolOpened(address indexed poolAgent, bytes32 subject);
    event PoolClosed(address indexed poolAgent, bytes32 subject);
    event PoolMandateUpdated(address indexed poolAgent, bytes32 newMandateHash);
    event PoolStewardsRotated(address indexed poolAgent, uint256 stewardCount);

    /// @dev Bag of args for `open` — keeps the public ABI legible without
    ///      hitting Solidity's stack-depth limit.
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
    }

    modifier onlyPoolOwner(address poolAgent) {
        if (poolAgent.code.length == 0) revert NotPoolOwner();
        (bool ok, bytes memory data) = poolAgent.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        if (!ok || data.length < 32 || !abi.decode(data, (bool))) revert NotPoolOwner();
        _;
    }

    constructor(address store, address shapes) {
        STORE = OntologyAttributeStore(store);
        SHAPES = ShapeRegistry(shapes);
    }

    function _subject(address poolAgent) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(poolAgent)));
    }

    function open(OpenParams calldata p) external onlyPoolOwner(p.poolAgent) {
        bytes32 s = _subject(p.poolAgent);

        STORE.setBytes32(s, SA_POOL_DOMAIN, p.domain);
        STORE.setBytes32(s, SA_POOL_GOVERNANCE_MODEL, p.governanceModel);
        STORE.setBytes32(s, SA_POOL_MANDATE_HASH, p.mandateHash);
        if (bytes(p.mandateURI).length > 0) {
            STORE.setString(s, SA_POOL_MANDATE_URI, p.mandateURI);
        }
        if (p.acceptedUnits.length > 0) {
            STORE.setBytes32Arr(s, SA_POOL_ACCEPTED_UNITS, p.acceptedUnits);
        }
        STORE.setBytes32Arr(s, SA_POOL_ACCEPTED_KINDS, p.acceptedKinds);
        STORE.setBytes32(s, SA_POOL_CEILING_POLICY, p.ceilingPolicy);
        if (p.capacityCeiling > 0) {
            STORE.setUint(s, SA_POOL_CAPACITY_CEILING, p.capacityCeiling);
        }
        STORE.setAddressArr(s, SA_POOL_STEWARDS, p.stewards);
        STORE.setBytes32(s, SA_POOL_VISIBILITY, p.visibility);
        STORE.setUint(s, SA_POOL_OPENED_AT, block.timestamp);

        SHAPES.validateSubject(CLASS_POOL, s);

        emit PoolOpened(p.poolAgent, s);
    }

    function close(address poolAgent) external onlyPoolOwner(poolAgent) {
        bytes32 s = _subject(poolAgent);
        STORE.setUint(s, SA_POOL_CLOSED_AT, block.timestamp);
        emit PoolClosed(poolAgent, s);
    }

    function updateMandate(
        address poolAgent,
        bytes32 newMandateHash,
        string calldata newMandateURI
    ) external onlyPoolOwner(poolAgent) {
        bytes32 s = _subject(poolAgent);
        STORE.setBytes32(s, SA_POOL_MANDATE_HASH, newMandateHash);
        if (bytes(newMandateURI).length > 0) {
            STORE.setString(s, SA_POOL_MANDATE_URI, newMandateURI);
        }
        emit PoolMandateUpdated(poolAgent, newMandateHash);
    }

    function rotateStewards(
        address poolAgent,
        address[] calldata newStewards
    ) external onlyPoolOwner(poolAgent) {
        bytes32 s = _subject(poolAgent);
        STORE.setAddressArr(s, SA_POOL_STEWARDS, newStewards);
        emit PoolStewardsRotated(poolAgent, newStewards.length);
    }

    // ─── Read helpers ──────────────────────────────────────────────

    function getDomain(address poolAgent) external view returns (bytes32) {
        return STORE.getBytes32(_subject(poolAgent), SA_POOL_DOMAIN);
    }

    function getGovernanceModel(address poolAgent) external view returns (bytes32) {
        return STORE.getBytes32(_subject(poolAgent), SA_POOL_GOVERNANCE_MODEL);
    }

    function getMandate(address poolAgent) external view returns (bytes32 mandateHash, string memory mandateURI) {
        bytes32 s = _subject(poolAgent);
        mandateHash = STORE.getBytes32(s, SA_POOL_MANDATE_HASH);
        mandateURI = STORE.getString(s, SA_POOL_MANDATE_URI);
    }

    function getAcceptedKinds(address poolAgent) external view returns (bytes32[] memory) {
        return STORE.getBytes32Arr(_subject(poolAgent), SA_POOL_ACCEPTED_KINDS);
    }

    function getAcceptedUnits(address poolAgent) external view returns (bytes32[] memory) {
        return STORE.getBytes32Arr(_subject(poolAgent), SA_POOL_ACCEPTED_UNITS);
    }

    function getStewards(address poolAgent) external view returns (address[] memory) {
        return STORE.getAddressArr(_subject(poolAgent), SA_POOL_STEWARDS);
    }

    function getCeilingPolicy(address poolAgent) external view returns (bytes32) {
        return STORE.getBytes32(_subject(poolAgent), SA_POOL_CEILING_POLICY);
    }

    function getCapacityCeiling(address poolAgent) external view returns (uint256) {
        return STORE.getUint(_subject(poolAgent), SA_POOL_CAPACITY_CEILING);
    }

    function getVisibility(address poolAgent) external view returns (bytes32) {
        return STORE.getBytes32(_subject(poolAgent), SA_POOL_VISIBILITY);
    }

    function getOpenedAt(address poolAgent) external view returns (uint256) {
        return STORE.getUint(_subject(poolAgent), SA_POOL_OPENED_AT);
    }

    function getClosedAt(address poolAgent) external view returns (uint256) {
        return STORE.getUint(_subject(poolAgent), SA_POOL_CLOSED_AT);
    }

    function isOpen(address poolAgent) external view returns (bool) {
        bytes32 s = _subject(poolAgent);
        return STORE.isSet(s, SA_POOL_OPENED_AT) && !STORE.isSet(s, SA_POOL_CLOSED_AT);
    }
}
