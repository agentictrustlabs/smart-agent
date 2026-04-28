// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SkillIssuerRegistry
 * @notice On-chain registry of trusted skill issuers. Replaces the
 *         "signed manifest in the repo" pattern that v0/v1 skill-mcp
 *         used to ship issuer trust as configuration.
 *
 * Purpose. Issuer-trust scoring at search time wants a list of
 * authoritative answers to:
 *   • Is this issuer registered?
 *   • What skillIds is this issuer authorised to attest about? (or
 *     wildcard: all skills)
 *   • What is this issuer's trust weight (0..10000 = 0.0..1.0×)?
 *   • Has stake been slashed?
 *
 * The registry does NOT block claim minting in `AgentSkillRegistry` —
 * unknown issuers can still mint cross-issued claims. The scorer
 * applies issuer-trust at ranking time, NOT mint time. This separation
 * keeps the data layer permissionless while letting consumers filter
 * down to authorities they recognise.
 *
 * Stake. v1 ships a bookkeeping-only stake field — the contract tracks
 * `stakeWei` per issuer but does not custody ETH yet (deposit/withdraw
 * mechanics are deferred to v2 governance). Slashing is a curator-only
 * write that decrements `stakeWei` and emits `IssuerSlashed`. UI surfaces
 * "stake amount" and "slashed history" from these events.
 *
 * Curator. The contract has a single curator address (set at deploy)
 * which can register/deactivate issuers. v2 promotes this to a multi-sig
 * or DAO; v1 keeps it deployer-controlled because the alternative —
 * bootstrapping governance for an empty registry — is the harder problem.
 *
 * Auth model: mirrors `SkillDefinitionRegistry._isAuthorized` so
 * registered issuer agents can update their own metadata, while only
 * the curator can register new issuers or slash stake.
 */
contract SkillIssuerRegistry {

    // ─── Constants ──────────────────────────────────────────────────

    /// @notice Wildcard skillId — issuer is authorised for ALL skills.
    bytes32 public constant ANY_SKILL = bytes32(0);

    /// @notice Issuer-trust scale: 0..10000 (basis points).
    uint16 public constant MAX_TRUST = 10000;

    // ─── Types ──────────────────────────────────────────────────────

    struct Issuer {
        address account;            // issuer's smart account (or EOA)
        string  did;                // did:smart-agent:... or did:web:...
        string  metadataURI;        // JSON-LD profile (alsoKnownAs, logoUrl, …)
        uint16  trustWeight;        // 0..10000
        uint128 stakeWei;           // bookkeeping; not custodied (v2)
        uint64  registeredAt;
        bool    active;
    }

    // ─── Errors ─────────────────────────────────────────────────────

    error NotCurator();
    error NotAuthorized();
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidTrust();
    error InvalidStake();

    // ─── Events ─────────────────────────────────────────────────────

    event IssuerRegistered(
        address indexed account,
        string did,
        uint16 trustWeight,
        uint128 stakeWei,
        string metadataURI
    );
    event IssuerUpdated(address indexed account, uint16 trustWeight, string metadataURI);
    event IssuerDeactivated(address indexed account);
    event IssuerActivated(address indexed account);
    event IssuerSkillAuthorised(address indexed account, bytes32 indexed skillId);
    event IssuerSkillRevoked(address indexed account, bytes32 indexed skillId);
    event IssuerSlashed(address indexed account, uint128 amountWei, string reason);
    event CuratorChanged(address indexed previous, address indexed current);

    // ─── State ──────────────────────────────────────────────────────

    address public curator;

    mapping(address => Issuer) private _issuers;
    address[] private _allIssuers;
    mapping(string => address) private _issuerByDid;

    /// @notice (issuer, skillId) → authorised. ANY_SKILL means wildcard.
    mapping(address => mapping(bytes32 => bool)) private _authorisedFor;
    /// @notice issuer → enumerated skill ids (excluding wildcard).
    mapping(address => bytes32[]) private _issuerSkills;

    // ─── Constructor ────────────────────────────────────────────────

    constructor(address curator_) {
        curator = curator_ == address(0) ? msg.sender : curator_;
        emit CuratorChanged(address(0), curator);
    }

    // ─── Curator management ─────────────────────────────────────────

    function setCurator(address next) external {
        if (msg.sender != curator) revert NotCurator();
        emit CuratorChanged(curator, next);
        curator = next;
    }

    // ─── Registration ───────────────────────────────────────────────

    /**
     * @notice Register a new issuer. Only the curator may call.
     * @param account The issuer's smart account (or EOA).
     * @param did The issuer's DID (did:smart-agent:... or did:web:...).
     * @param weight 0..10000. Higher = more weight at scoring time.
     * @param initialStakeWei Bookkeeping; the registry does not custody ETH yet.
     * @param metadataURI JSON-LD profile pointer.
     * @param skillIds Skill ids this issuer is authorised for. Pass
     *        `[ANY_SKILL]` for wildcard authority.
     */
    function registerIssuer(
        address account,
        string calldata did,
        uint16 weight,
        uint128 initialStakeWei,
        string calldata metadataURI,
        bytes32[] calldata skillIds
    ) external {
        if (msg.sender != curator) revert NotCurator();
        if (account == address(0)) revert NotAuthorized();
        if (weight > MAX_TRUST) revert InvalidTrust();
        if (_issuers[account].registeredAt != 0) revert AlreadyRegistered();

        _issuers[account] = Issuer({
            account: account,
            did: did,
            metadataURI: metadataURI,
            trustWeight: weight,
            stakeWei: initialStakeWei,
            registeredAt: uint64(block.timestamp),
            active: true
        });
        _allIssuers.push(account);
        if (bytes(did).length > 0) _issuerByDid[did] = account;

        for (uint256 i = 0; i < skillIds.length; i++) {
            _authoriseFor(account, skillIds[i]);
        }

        emit IssuerRegistered(account, did, weight, initialStakeWei, metadataURI);
    }

    /// @notice Update mutable metadata. Curator OR the issuer itself.
    function updateIssuer(address account, uint16 weight, string calldata metadataURI) external {
        Issuer storage iss = _issuers[account];
        if (iss.registeredAt == 0) revert NotRegistered();
        if (msg.sender != curator && !_isAuthorized(account)) revert NotAuthorized();
        if (weight > MAX_TRUST) revert InvalidTrust();
        iss.trustWeight = weight;
        iss.metadataURI = metadataURI;
        emit IssuerUpdated(account, weight, metadataURI);
    }

    function deactivateIssuer(address account) external {
        if (msg.sender != curator) revert NotCurator();
        Issuer storage iss = _issuers[account];
        if (iss.registeredAt == 0) revert NotRegistered();
        iss.active = false;
        emit IssuerDeactivated(account);
    }

    function activateIssuer(address account) external {
        if (msg.sender != curator) revert NotCurator();
        Issuer storage iss = _issuers[account];
        if (iss.registeredAt == 0) revert NotRegistered();
        iss.active = true;
        emit IssuerActivated(account);
    }

    // ─── Skill authority ────────────────────────────────────────────

    function authoriseSkill(address account, bytes32 skillId) external {
        if (msg.sender != curator) revert NotCurator();
        if (_issuers[account].registeredAt == 0) revert NotRegistered();
        _authoriseFor(account, skillId);
    }

    function revokeSkill(address account, bytes32 skillId) external {
        if (msg.sender != curator) revert NotCurator();
        if (!_authorisedFor[account][skillId]) revert NotRegistered();
        _authorisedFor[account][skillId] = false;
        emit IssuerSkillRevoked(account, skillId);
    }

    function _authoriseFor(address account, bytes32 skillId) internal {
        if (_authorisedFor[account][skillId]) return;
        _authorisedFor[account][skillId] = true;
        if (skillId != ANY_SKILL) _issuerSkills[account].push(skillId);
        emit IssuerSkillAuthorised(account, skillId);
    }

    // ─── Slashing (bookkeeping only, no custody yet) ────────────────

    /**
     * @notice Decrement an issuer's recorded stake. Curator only.
     *         Does NOT transfer ETH — v1 ships bookkeeping-only stake.
     */
    function slash(address account, uint128 amountWei, string calldata reason) external {
        if (msg.sender != curator) revert NotCurator();
        Issuer storage iss = _issuers[account];
        if (iss.registeredAt == 0) revert NotRegistered();
        if (amountWei > iss.stakeWei) revert InvalidStake();
        unchecked { iss.stakeWei -= amountWei; }
        emit IssuerSlashed(account, amountWei, reason);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getIssuer(address account) external view returns (Issuer memory) {
        return _issuers[account];
    }

    function issuerByDid(string calldata did) external view returns (address) {
        return _issuerByDid[did];
    }

    function isRegistered(address account) external view returns (bool) {
        return _issuers[account].registeredAt != 0;
    }

    function isActive(address account) external view returns (bool) {
        Issuer storage iss = _issuers[account];
        return iss.registeredAt != 0 && iss.active;
    }

    /// @notice True iff `account` is registered, active, and authorised
    ///         for `skillId` (either explicitly or via ANY_SKILL).
    function canIssue(address account, bytes32 skillId) external view returns (bool) {
        Issuer storage iss = _issuers[account];
        if (iss.registeredAt == 0 || !iss.active) return false;
        return _authorisedFor[account][skillId] || _authorisedFor[account][ANY_SKILL];
    }

    /// @notice Issuer-trust weight at scoring time. Returns 0 for
    ///         unregistered/inactive issuers — the scorer should fall
    ///         back to its default issuer-trust floor (typically 1.0×
    ///         for cross-issued, 0.5× for self-attested).
    function trustWeight(address account) external view returns (uint16) {
        Issuer storage iss = _issuers[account];
        if (iss.registeredAt == 0 || !iss.active) return 0;
        return iss.trustWeight;
    }

    function allIssuers() external view returns (address[] memory) {
        return _allIssuers;
    }

    function issuerSkills(address account) external view returns (bytes32[] memory) {
        return _issuerSkills[account];
    }

    // ─── Auth helpers ───────────────────────────────────────────────

    function _isAuthorized(address account) internal view returns (bool) {
        if (msg.sender == account) return true;
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("isOwner(address)", msg.sender)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }
}
