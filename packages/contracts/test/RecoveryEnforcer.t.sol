// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/RecoveryEnforcer.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract RecoveryEnforcerTest is Test {
    using MessageHashUtils for bytes32;

    RecoveryEnforcer internal enforcer;
    address internal delegator = address(0xDE1E6A70);
    address internal redeemer  = address(0xBEEF);
    bytes32 internal delegationHash = keccak256("delegation#recovery");
    address internal target = address(0xACCCC07);
    bytes   internal callData = hex"deadbeef";
    uint256 internal value = 0;

    address internal g1; uint256 internal g1Key;
    address internal g2; uint256 internal g2Key;
    address internal g3; uint256 internal g3Key;
    address internal attacker; uint256 internal attackerKey;

    function setUp() public {
        enforcer = new RecoveryEnforcer();
        (g1, g1Key) = makeAddrAndKey("g1");
        (g2, g2Key) = makeAddrAndKey("g2");
        (g3, g3Key) = makeAddrAndKey("g3");
        (attacker, attackerKey) = makeAddrAndKey("attacker");
    }

    function _guardians() internal view returns (address[] memory g) {
        g = new address[](3);
        g[0] = g1; g[1] = g2; g[2] = g3;
    }

    function _terms(uint256 threshold, uint256 delay) internal view returns (bytes memory) {
        return abi.encode(_guardians(), threshold, delay);
    }

    function _intentHash() internal view returns (bytes32) {
        return enforcer.computeIntentHash(block.chainid, delegator, target, value, callData);
    }

    function _sign(uint256 key, bytes32 h) internal pure returns (bytes memory) {
        bytes32 ethSigned = h.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethSigned);
        return abi.encodePacked(r, s, v);
    }

    function _redeem(bytes memory terms, bytes memory args) internal {
        enforcer.beforeHook(terms, args, delegationHash, delegator, redeemer, target, value, callData);
    }

    // ─── Happy path ─────────────────────────────────────────────────

    function test_happy_path_meets_threshold_and_delay() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g2Key, hash);

        _redeem(_terms(2, 300), abi.encode(hash, sigs));
        assertTrue(enforcer.consumed(delegator, hash));
    }

    function test_records_proposedAt_on_propose() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        assertEq(enforcer.proposedAt(delegator, hash), uint64(block.timestamp));
    }

    // ─── Negative cases ─────────────────────────────────────────────

    function test_revert_not_proposed() public {
        bytes32 hash = _intentHash();
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g2Key, hash);
        vm.expectRevert(RecoveryEnforcer.NotProposed.selector);
        _redeem(_terms(2, 300), abi.encode(hash, sigs));
    }

    function test_revert_delay_not_elapsed() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        // stay BEFORE the delay elapses
        vm.warp(block.timestamp + 100);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g2Key, hash);
        bytes memory terms = _terms(2, 300);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(abi.encodeWithSelector(RecoveryEnforcer.DelayNotElapsed.selector, uint64(block.timestamp + 200)));
        _redeem(terms, args);
    }

    function test_revert_insufficient_signatures() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(g1Key, hash);
        bytes memory terms = _terms(2, 300);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(abi.encodeWithSelector(RecoveryEnforcer.InsufficientSignatures.selector, 1, 2));
        _redeem(terms, args);
    }

    function test_revert_unknown_guardian() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(attackerKey, hash);  // not a guardian
        bytes memory terms = _terms(2, 300);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(abi.encodeWithSelector(RecoveryEnforcer.UnknownGuardian.selector, attacker));
        _redeem(terms, args);
    }

    function test_revert_duplicate_signer() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g1Key, hash);        // same guardian twice
        bytes memory terms = _terms(2, 300);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(abi.encodeWithSelector(RecoveryEnforcer.DuplicateSigner.selector, g1));
        _redeem(terms, args);
    }

    function test_revert_intent_hash_mismatch() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g2Key, hash);
        bytes memory terms = _terms(2, 300);
        // Feed a different intentHash in args.
        bytes memory args = abi.encode(keccak256("not-the-intent"), sigs);
        vm.expectRevert(RecoveryEnforcer.IntentHashMismatch.selector);
        _redeem(terms, args);
    }

    function test_revert_replay_after_consume() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g2Key, hash);
        _redeem(_terms(2, 300), abi.encode(hash, sigs));

        // replay
        bytes memory terms = _terms(2, 300);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(RecoveryEnforcer.AlreadyConsumed.selector);
        _redeem(terms, args);
    }

    function test_cancel_clears_proposal() public {
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.prank(delegator);
        enforcer.cancel(hash);
        assertEq(enforcer.proposedAt(delegator, hash), 0);

        // Now redeem must fail with NotProposed.
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(g1Key, hash);
        sigs[1] = _sign(g2Key, hash);
        bytes memory terms = _terms(2, 300);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(RecoveryEnforcer.NotProposed.selector);
        _redeem(terms, args);
    }

    function test_invalid_terms_zero_threshold() public {
        bytes memory terms = abi.encode(_guardians(), uint256(0), uint256(300));
        bytes32 hash = _intentHash();
        enforcer.propose(delegator, hash);
        vm.warp(block.timestamp + 301);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(g1Key, hash);
        bytes memory args = abi.encode(hash, sigs);
        vm.expectRevert(RecoveryEnforcer.InvalidTerms.selector);
        _redeem(terms, args);
    }

    function test_7579_module_id() public view {
        assertEq(enforcer.moduleId(), "smart-agent-recovery-enforcer-1");
        assertTrue(enforcer.isModuleType(100)); // TYPE_CAVEAT_ENFORCER
        assertFalse(enforcer.isModuleType(1));
    }
}
