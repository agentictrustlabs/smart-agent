// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "../modules/IERC7579Module.sol";
import "../libraries/WebAuthnLib.sol";

/**
 * @title PasskeyValidator
 * @notice Per-account registry of WebAuthn credentials and ERC-1271-style
 *         verification. Useful for counterparty signature checks (DApps,
 *         EIP-712 messages) where the verifier isn't the account itself.
 *
 *         AgentAccount has its own native passkey path for ERC-4337 UserOps
 *         (storage in the account, so bundlers don't trip on cross-contract
 *         storage reads during validation). This validator is the
 *         complementary OFF-account path.
 *
 *         Storage layout: account → credentialIdDigest → P-256 pubkey.
 *         The raw credentialId never lands on-chain — only its keccak digest.
 */
contract PasskeyValidator is IERC7579Module {
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant ERC1271_INVALID     = 0xffffffff;

    struct PubKey { uint256 x; uint256 y; }

    mapping(address => mapping(bytes32 => PubKey)) private _keys;
    mapping(address => mapping(bytes32 => bool))   private _registered;
    mapping(address => uint256)                    private _count;

    event PasskeyRegistered(address indexed account, bytes32 indexed credentialIdDigest, uint256 x, uint256 y);
    event PasskeyRemoved(address indexed account, bytes32 indexed credentialIdDigest);

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidPublicKey();

    // ─── ERC-7579 marker ───────────────────────────────────────────────

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_VALIDATOR;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent-passkey-validator-2";
    }

    // ─── Registration ──────────────────────────────────────────────────

    function register(bytes32 credentialIdDigest, uint256 x, uint256 y) external {
        if (x == 0 || y == 0) revert InvalidPublicKey();
        if (_registered[msg.sender][credentialIdDigest]) revert AlreadyRegistered();
        _keys[msg.sender][credentialIdDigest] = PubKey(x, y);
        _registered[msg.sender][credentialIdDigest] = true;
        _count[msg.sender] += 1;
        emit PasskeyRegistered(msg.sender, credentialIdDigest, x, y);
    }

    function remove(bytes32 credentialIdDigest) external {
        if (!_registered[msg.sender][credentialIdDigest]) revert NotRegistered();
        delete _keys[msg.sender][credentialIdDigest];
        _registered[msg.sender][credentialIdDigest] = false;
        _count[msg.sender] -= 1;
        emit PasskeyRemoved(msg.sender, credentialIdDigest);
    }

    // ─── Views ─────────────────────────────────────────────────────────

    function hasCredential(address account, bytes32 credentialIdDigest) external view returns (bool) {
        return _registered[account][credentialIdDigest];
    }

    function getPubKey(address account, bytes32 credentialIdDigest) external view returns (uint256 x, uint256 y) {
        PubKey storage k = _keys[account][credentialIdDigest];
        return (k.x, k.y);
    }

    function count(address account) external view returns (uint256) {
        return _count[account];
    }

    // ─── Verification ──────────────────────────────────────────────────

    /**
     * @notice ERC-1271 verifier.
     * @dev `signature` is abi.encode(WebAuthnLib.Assertion).
     */
    function isValidSignature(address account, bytes32 hash, bytes calldata signature)
        external view returns (bytes4)
    {
        WebAuthnLib.Assertion memory a = abi.decode(signature, (WebAuthnLib.Assertion));
        PubKey storage k = _keys[account][a.credentialIdDigest];
        if (k.x == 0 && k.y == 0) return ERC1271_INVALID;
        return WebAuthnLib.verify(a, hash, k.x, k.y) ? ERC1271_MAGIC_VALUE : ERC1271_INVALID;
    }
}
