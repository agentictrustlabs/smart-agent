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
    // Records the donor's AgentAccount (msg.sender at submit). Gates
    // amend/stop so only the original donor can modify their pledge.
    bytes32 public constant SA_PLEDGE_DONOR             = keccak256("sa:pledgeDonor");

    // Spec 005 — settlement predicates. Per-token amounts use a
    // composite subject `keccak256(abi.encode(pledgeSubj, "honored"|"externalPaid", token))`
    // so AttributeStorage's flat KV can represent the per-(pledge, token) map.
    bytes32 public constant SA_PLEDGE_HONORED_AMOUNT         = keccak256("sa:pledgeHonoredAmount");
    bytes32 public constant SA_PLEDGE_EXTERNALLY_PAID_AMOUNT = keccak256("sa:pledgeExternallyPaidAmount");
    bytes32 public constant SA_PLEDGE_HONOR_TOKEN_LIST       = keccak256("sa:pledgeHonorTokenList");
    bytes32 public constant SA_PLEDGE_LAST_HONORED_AT        = keccak256("sa:pledgeLastHonoredAt");
    bytes32 public constant SA_PLEDGE_LAST_MARKED_AT         = keccak256("sa:pledgeLastMarkedAt");
    bytes32 public constant SA_PLEDGE_PAYMENT_RAIL           = keccak256("sa:pledgePaymentRail");
    bytes32 public constant SA_PLEDGE_EVIDENCE_HASH          = keccak256("sa:pledgeEvidenceHash");
    bytes32 public constant SA_PLEDGE_MARKED_BY_AGENT        = keccak256("sa:pledgeMarkedByAgent");

    bytes32 internal constant STATUS_FULLY_HONORED = keccak256("sa:PledgeFullyHonored");

    error NotPoolOperator();
    error NotPledgeDonor();
    error PledgeNotFound();
    error PledgeAmountExceedsCommitted();
    error EvidenceHashRequired();
    error InvalidToken();
    error NotDonorTreasury();

    event PledgeSubmitted(
        bytes32 indexed pledgeSubject,
        address indexed poolAgent,
        bytes32 indexed nullifier,
        uint256 amount,
        bytes32 unit
    );
    event PledgeAmended(bytes32 indexed pledgeSubject, uint256 newAmount);
    event PledgeStopped(bytes32 indexed pledgeSubject);

    // Spec 005 — settlement events.
    event PledgeHonored(
        bytes32 indexed pledgeSubject,
        address indexed treasury,
        address indexed token,
        uint256 amount,
        uint256 totalHonored
    );
    event PledgePaymentMarked(
        bytes32 indexed pledgeSubject,
        address indexed markedBy,
        address indexed token,
        uint256 amount,
        bytes32 rail,
        bytes32 evidenceHash,
        uint256 totalExternallyPaid
    );
    event PledgeFullyHonored(
        bytes32 indexed pledgeSubject,
        address indexed token,
        uint256 totalSettled
    );

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

    /// @notice Submit a pledge to a pool.
    /// @dev Permissionless: any caller may commit to a pool. The donor's
    ///      AgentAccount (`msg.sender`) is recorded as `sa:pledgeDonor` so
    ///      `amend`/`stop` can gate on identity. Pool-side screening (e.g.,
    ///      private-pool membership) is enforced off-chain by the pool's
    ///      MCP before issuing a session — not in this contract.
    function submit(SubmitParams calldata p) external {
        bytes32 subj = _pledgeSubject(p.poolAgent, p.nullifier, p.salt);
        _setAddress(subj, SA_PLEDGE_POOL, p.poolAgent);
        _setAddress(subj, SA_PLEDGE_DONOR, msg.sender);
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

    /// @dev Only the original donor (msg.sender at submit time, stored at
    ///      `sa:pledgeDonor`) may amend their pledge.
    function amend(bytes32 pledgeSubj, uint256 newAmount, uint256 newDuration) external {
        address poolAgent = this.getAddress(pledgeSubj, SA_PLEDGE_POOL);
        if (poolAgent == address(0)) revert PledgeNotFound();
        address donor = this.getAddress(pledgeSubj, SA_PLEDGE_DONOR);
        if (msg.sender != donor) revert NotPledgeDonor();
        _setUint(pledgeSubj, SA_PLEDGE_AMOUNT, newAmount);
        if (newDuration > 0) _setUint(pledgeSubj, SA_PLEDGE_DURATION, newDuration);
        emit PledgeAmended(pledgeSubj, newAmount);
    }

    /// @dev Only the original donor may stop their pledge.
    function stop(bytes32 pledgeSubj) external {
        address poolAgent = this.getAddress(pledgeSubj, SA_PLEDGE_POOL);
        if (poolAgent == address(0)) revert PledgeNotFound();
        address donor = this.getAddress(pledgeSubj, SA_PLEDGE_DONOR);
        if (msg.sender != donor) revert NotPledgeDonor();
        _setBytes32(pledgeSubj, SA_PLEDGE_STATUS, keccak256("sa:PledgeStopped"));
        _setUint(pledgeSubj, SA_PLEDGE_STOPPED_AT, block.timestamp);
        emit PledgeStopped(pledgeSubj);
    }

    // ─── Spec 005 — settlement ───────────────────────────────────────

    /// @dev Composite subject for per-(pledge, token) settlement attributes.
    function _settlementSubject(
        bytes32 pledgeSubj,
        bytes32 kind,
        address token
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(pledgeSubj, kind, token));
    }

    /// @dev Append token to the per-pledge honored-tokens list if absent.
    function _addTokenToList(bytes32 pledgeSubj, address token) internal {
        bytes32 tokenAsBytes = bytes32(uint256(uint160(token)));
        bytes32[] memory current = this.getBytes32Arr(pledgeSubj, SA_PLEDGE_HONOR_TOKEN_LIST);
        for (uint256 i = 0; i < current.length; i++) {
            if (current[i] == tokenAsBytes) return;
        }
        _appendBytes32(pledgeSubj, SA_PLEDGE_HONOR_TOKEN_LIST, tokenAsBytes);
    }

    /// @dev Promote a pledge to fully-honored status iff (honored + external)
    ///      for `token` meets/exceeds the committed amount.
    ///      The pledge's `sa:pledgeUnit` is the canonical settlement token
    ///      label (concept hash). We DO NOT enforce token == unit on chain
    ///      because callers may use a token-address representation rather
    ///      than the unit concept hash. The off-chain SHACL gate enforces
    ///      the semantic match. On chain we simply trust the aggregate sum
    ///      against `SA_PLEDGE_AMOUNT`.
    function _maybeMarkFullyHonored(
        bytes32 pledgeSubj,
        address token,
        uint256 totalSettled
    ) internal {
        uint256 committed = this.getUint(pledgeSubj, SA_PLEDGE_AMOUNT);
        if (committed == 0) return;
        if (totalSettled >= committed) {
            _setBytes32(pledgeSubj, SA_PLEDGE_STATUS, STATUS_FULLY_HONORED);
            emit PledgeFullyHonored(pledgeSubj, token, totalSettled);
        }
    }

    /// @notice Record a cryptographically-proven settlement from the donor
    ///         treasury. Intended to be called from inside an
    ///         `AgentAccount.executeBatch` whose preceding call is
    ///         `token.transfer(poolAgent, amount)`. The chain doesn't verify
    ///         the transfer happened — `msg.sender == treasury` is the gate
    ///         and the same-tx transfer is the proof (visible via the
    ///         token's Transfer event).
    function recordHonor(
        bytes32 pledgeSubj,
        address treasury,
        address token,
        uint256 amount
    ) external {
        if (!this.isSet(pledgeSubj, SA_PLEDGE_POOL)) revert PledgeNotFound();
        if (token == address(0)) revert InvalidToken();
        if (msg.sender != treasury) revert NotDonorTreasury();

        bytes32 honoredKey = _settlementSubject(pledgeSubj, "honored", token);
        uint256 prev = 0;
        if (this.isSet(honoredKey, SA_PLEDGE_HONORED_AMOUNT)) {
            prev = this.getUint(honoredKey, SA_PLEDGE_HONORED_AMOUNT);
        }
        uint256 next = prev + amount;

        uint256 externalPaid = 0;
        bytes32 externalKey = _settlementSubject(pledgeSubj, "externalPaid", token);
        if (this.isSet(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT)) {
            externalPaid = this.getUint(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT);
        }
        uint256 committed = this.getUint(pledgeSubj, SA_PLEDGE_AMOUNT);
        if (committed > 0 && next + externalPaid > committed) revert PledgeAmountExceedsCommitted();

        _setUint(honoredKey, SA_PLEDGE_HONORED_AMOUNT, next);
        _addTokenToList(pledgeSubj, token);
        _setUint(pledgeSubj, SA_PLEDGE_LAST_HONORED_AT, block.timestamp);

        emit PledgeHonored(pledgeSubj, treasury, token, amount, next);
        _maybeMarkFullyHonored(pledgeSubj, token, next + externalPaid);
    }

    /// @notice Record an attested external (off-chain) settlement.
    ///         Only callable by the pool's fund operator. Evidence hash is
    ///         the sha256 of the receipt document; the document itself
    ///         lives in org-mcp.
    function markPaid(
        bytes32 pledgeSubj,
        address token,
        uint256 amount,
        bytes32 rail,
        bytes32 evidenceHash
    ) external {
        address poolAgent = this.getAddress(pledgeSubj, SA_PLEDGE_POOL);
        if (poolAgent == address(0)) revert PledgeNotFound();
        if (evidenceHash == bytes32(0)) revert EvidenceHashRequired();
        if (!_isAccountOwner(poolAgent, msg.sender)) revert NotPoolOperator();

        bytes32 externalKey = _settlementSubject(pledgeSubj, "externalPaid", token);
        uint256 prev = 0;
        if (this.isSet(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT)) {
            prev = this.getUint(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT);
        }
        uint256 next = prev + amount;

        uint256 honored = 0;
        bytes32 honoredKey = _settlementSubject(pledgeSubj, "honored", token);
        if (this.isSet(honoredKey, SA_PLEDGE_HONORED_AMOUNT)) {
            honored = this.getUint(honoredKey, SA_PLEDGE_HONORED_AMOUNT);
        }
        uint256 committed = this.getUint(pledgeSubj, SA_PLEDGE_AMOUNT);
        if (committed > 0 && next + honored > committed) revert PledgeAmountExceedsCommitted();

        _setUint(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT, next);
        _addTokenToList(pledgeSubj, token);
        _setUint(pledgeSubj, SA_PLEDGE_LAST_MARKED_AT, block.timestamp);
        _setBytes32(pledgeSubj, SA_PLEDGE_PAYMENT_RAIL, rail);
        _setBytes32(pledgeSubj, SA_PLEDGE_EVIDENCE_HASH, evidenceHash);
        _setAddress(pledgeSubj, SA_PLEDGE_MARKED_BY_AGENT, msg.sender);

        emit PledgePaymentMarked(pledgeSubj, msg.sender, token, amount, rail, evidenceHash, next);
        _maybeMarkFullyHonored(pledgeSubj, token, next + honored);
    }

    /// @notice View helper — per-token settlement breakdown for a pledge.
    function getSettlement(bytes32 pledgeSubj, address token)
        external
        view
        returns (uint256 honored, uint256 externallyPaid)
    {
        bytes32 honoredKey = _settlementSubject(pledgeSubj, "honored", token);
        bytes32 externalKey = _settlementSubject(pledgeSubj, "externalPaid", token);
        if (this.isSet(honoredKey, SA_PLEDGE_HONORED_AMOUNT)) {
            honored = this.getUint(honoredKey, SA_PLEDGE_HONORED_AMOUNT);
        }
        if (this.isSet(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT)) {
            externallyPaid = this.getUint(externalKey, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT);
        }
    }
}
