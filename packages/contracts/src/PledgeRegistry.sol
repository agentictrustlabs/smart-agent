// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";
import "./ShapeRegistry.sol";

/**
 * @title PledgeRegistry
 * @notice On-chain authoritative store for pool pledges. Each row is
 *         **nullifier-keyed** — no donor identity is ever stored on chain.
 *         The story-permissions JSON on the row is what the
 *         on-chain→GraphDB mirror consults when deciding whether to
 *         emit a public donor label (the mirror is the privacy boundary,
 *         not the contract).
 *
 * Subject = keccak256("sa:pledge:", poolAgent, nullifier, salt). The salt
 * lets the same credential pledge more than once to the same pool
 * (e.g. amend a previous pledge, or stack pledges).
 *
 * Auth: the pool's owner AgentAccount is the writer (org-mcp acts on its
 * behalf). org-mcp verifies the AnonCreds presentation off-chain before
 * submitting.
 */
contract PledgeRegistry is AttributeStorage {
    ShapeRegistry public immutable SHAPES;

    bytes32 public constant CLASS_PLEDGE = keccak256("sa:Pledge");

    bytes32 public constant SA_PLEDGE_POOL              = keccak256("sa:pledgePool");
    bytes32 public constant SA_PLEDGE_NULLIFIER         = keccak256("sa:pledgeNullifier");
    bytes32 public constant SA_PLEDGE_AMOUNT            = keccak256("sa:pledgeAmount");
    bytes32 public constant SA_PLEDGE_UNIT              = keccak256("sa:pledgeUnit");              // concept hash
    bytes32 public constant SA_PLEDGE_CADENCE           = keccak256("sa:pledgeCadence");           // concept hash
    bytes32 public constant SA_PLEDGE_DURATION          = keccak256("sa:pledgeDuration");
    bytes32 public constant SA_PLEDGE_RESTRICTIONS      = keccak256("sa:pledgeRestrictions");      // JSON
    bytes32 public constant SA_PLEDGE_STORY_PERMISSIONS = keccak256("sa:pledgeStoryPermissions"); // JSON
    bytes32 public constant SA_PLEDGE_PLEDGED_AT        = keccak256("sa:pledgePledgedAt");
    bytes32 public constant SA_PLEDGE_STOPPED_AT        = keccak256("sa:pledgeStoppedAt");
    bytes32 public constant SA_PLEDGE_STATUS            = keccak256("sa:pledgeStatus");           // concept hash

    error NotPoolOperator();
    error PledgeNotFound();

    event PledgeSubmitted(
        bytes32 indexed pledgeSubject,
        address indexed poolAgent,
        bytes32 indexed nullifier,
        uint256 amount,
        bytes32 unit
    );
    event PledgeAmended(bytes32 indexed pledgeSubject, uint256 newAmount);
    event PledgeStopped(bytes32 indexed pledgeSubject);

    struct SubmitParams {
        address poolAgent;
        bytes32 nullifier;
        uint256 salt;
        uint256 amount;
        bytes32 unit;
        bytes32 cadence;
        uint256 duration;            // 0 if not bounded
        string  restrictionsJson;
        string  storyPermissionsJson;
    }

    constructor(address ontologyRegistry, address shapes)
        AttributeStorage(ontologyRegistry)
    {
        SHAPES = ShapeRegistry(shapes);
    }

    function _pledgeSubject(address poolAgent, bytes32 nullifier, uint256 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("sa:pledge:", poolAgent, nullifier, salt));
    }

    function pledgeSubject(address poolAgent, bytes32 nullifier, uint256 salt) external pure returns (bytes32) {
        return _pledgeSubject(poolAgent, nullifier, salt);
    }

    function _isAccountOwner(address account, address actor) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", actor)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    modifier onlyPoolOperator(address poolAgent) {
        if (!_isAccountOwner(poolAgent, msg.sender)) revert NotPoolOperator();
        _;
    }

    function submit(SubmitParams calldata p) external onlyPoolOperator(p.poolAgent) {
        bytes32 subj = _pledgeSubject(p.poolAgent, p.nullifier, p.salt);
        _setAddress(subj, SA_PLEDGE_POOL, p.poolAgent);
        _setBytes32(subj, SA_PLEDGE_NULLIFIER, p.nullifier);
        _setUint(subj, SA_PLEDGE_AMOUNT, p.amount);
        _setBytes32(subj, SA_PLEDGE_UNIT, p.unit);
        _setBytes32(subj, SA_PLEDGE_CADENCE, p.cadence);
        if (p.duration > 0) _setUint(subj, SA_PLEDGE_DURATION, p.duration);
        if (bytes(p.restrictionsJson).length > 0) _setString(subj, SA_PLEDGE_RESTRICTIONS, p.restrictionsJson);
        if (bytes(p.storyPermissionsJson).length > 0) _setString(subj, SA_PLEDGE_STORY_PERMISSIONS, p.storyPermissionsJson);
        _setUint(subj, SA_PLEDGE_PLEDGED_AT, block.timestamp);
        _setBytes32(subj, SA_PLEDGE_STATUS, keccak256("sa:PledgeActive"));
        SHAPES.validateSubject(CLASS_PLEDGE, subj, address(this));
        emit PledgeSubmitted(subj, p.poolAgent, p.nullifier, p.amount, p.unit);
    }

    function amend(bytes32 pledgeSubj, uint256 newAmount, uint256 newDuration) external {
        address poolAgent = this.getAddress(pledgeSubj, SA_PLEDGE_POOL);
        if (poolAgent == address(0)) revert PledgeNotFound();
        if (!_isAccountOwner(poolAgent, msg.sender)) revert NotPoolOperator();
        _setUint(pledgeSubj, SA_PLEDGE_AMOUNT, newAmount);
        if (newDuration > 0) _setUint(pledgeSubj, SA_PLEDGE_DURATION, newDuration);
        emit PledgeAmended(pledgeSubj, newAmount);
    }

    function stop(bytes32 pledgeSubj) external {
        address poolAgent = this.getAddress(pledgeSubj, SA_PLEDGE_POOL);
        if (poolAgent == address(0)) revert PledgeNotFound();
        if (!_isAccountOwner(poolAgent, msg.sender)) revert NotPoolOperator();
        _setBytes32(pledgeSubj, SA_PLEDGE_STATUS, keccak256("sa:PledgeStopped"));
        _setUint(pledgeSubj, SA_PLEDGE_STOPPED_AT, block.timestamp);
        emit PledgeStopped(pledgeSubj);
    }
}
