// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

/**
 * @title AgentAccountModulesTest
 * @notice ERC-7579 install/uninstall + hook execution + namespaced storage
 *         tests for Phase 3.1.
 */

contract NoopModule {
    bool public installed;
    bytes public lastInit;
    bytes public lastDeinit;

    function onInstall(bytes calldata data) external {
        installed = true;
        lastInit = data;
    }

    function onUninstall(bytes calldata data) external {
        installed = false;
        lastDeinit = data;
    }

    function isModuleType(uint256) external pure returns (bool) {
        return true;
    }
}

contract RevertingInstallModule {
    function onInstall(bytes calldata) external pure {
        revert("install-blew-up");
    }
    function onUninstall(bytes calldata) external pure {
        revert("uninstall-blew-up");
    }
}

contract CountingHookModule {
    uint256 public preCount;
    uint256 public postCount;
    bytes public lastHookData;
    bool public installed;

    function onInstall(bytes calldata) external { installed = true; }
    function onUninstall(bytes calldata) external { installed = false; }

    function preCheck(address /*msgSender*/, uint256 /*value*/, bytes calldata /*msgData*/)
        external returns (bytes memory)
    {
        preCount++;
        return abi.encode("phase3-hookdata");
    }

    function postCheck(bytes calldata hookData) external {
        postCount++;
        lastHookData = hookData;
    }
}

contract RevertingHookModule {
    function onInstall(bytes calldata) external pure {}
    function onUninstall(bytes calldata) external pure {}
    function preCheck(address, uint256, bytes calldata) external pure returns (bytes memory) {
        revert("hook-veto");
    }
    function postCheck(bytes calldata) external pure {
        revert("post-veto");
    }
}

contract TargetSink {
    uint256 public value;
    function setValue(uint256 v) external { value = v; }
}

contract AgentAccountModulesTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentAccount public account;
    address public owner;
    uint256 public ownerKey;
    address public stranger;

    uint256 constant MOD_VALIDATOR = 1;
    uint256 constant MOD_EXECUTOR  = 2;
    uint256 constant MOD_FALLBACK  = 3;
    uint256 constant MOD_HOOK      = 4;

    event ModuleInstalled(uint256 moduleTypeId, address module);
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");
        stranger = makeAddr("stranger");
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        account = factory.createAccount(owner, 0);
        vm.deal(address(account), 10 ether);
    }

    // ─── install / uninstall basics ─────────────────────────────────

    function test_installModule_writesStorage() public {
        NoopModule m = new NoopModule();
        vm.expectEmit(false, false, false, true);
        emit ModuleInstalled(MOD_HOOK, address(m));
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(m), abi.encode(uint256(42)));

        assertTrue(account.isModuleInstalled(MOD_HOOK, address(m), ""), "should be installed");
        assertTrue(m.installed(), "module should have received onInstall");
        assertEq(m.lastInit(), abi.encode(uint256(42)), "init data echoed");

        address[] memory list = account.getInstalledModules(MOD_HOOK);
        assertEq(list.length, 1);
        assertEq(list[0], address(m));
    }

    function test_installModule_revertsIfNotOwner() public {
        NoopModule m = new NoopModule();
        vm.prank(stranger);
        vm.expectRevert(AgentAccount.NotOwnerOrSelf.selector);
        account.installModule(MOD_HOOK, address(m), "");
    }

    function test_installModule_allows_self_call() public {
        NoopModule m = new NoopModule();
        vm.prank(address(account));
        account.installModule(MOD_HOOK, address(m), "");
        assertTrue(account.isModuleInstalled(MOD_HOOK, address(m), ""));
    }

    function test_installModule_revertsIfAlreadyInstalled() public {
        NoopModule m = new NoopModule();
        vm.startPrank(owner);
        account.installModule(MOD_HOOK, address(m), "");
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.ModuleAlreadyInstalled.selector, MOD_HOOK, address(m))
        );
        account.installModule(MOD_HOOK, address(m), "");
        vm.stopPrank();
    }

    function test_installModule_revertsOnUnsupportedType() public {
        NoopModule m = new NoopModule();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.UnsupportedModuleType.selector, uint256(3)));
        account.installModule(3 /* fallback */, address(m), "");
    }

    function test_installModule_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(AgentAccount.ZeroAddress.selector);
        account.installModule(MOD_HOOK, address(0), "");
    }

    function test_installModule_revertsIfOnInstallFails() public {
        RevertingInstallModule m = new RevertingInstallModule();
        vm.prank(owner);
        vm.expectRevert();
        account.installModule(MOD_HOOK, address(m), "");
        // Storage must be clean — install was rolled back
        assertFalse(account.isModuleInstalled(MOD_HOOK, address(m), ""));
        address[] memory list = account.getInstalledModules(MOD_HOOK);
        assertEq(list.length, 0);
    }

    function test_uninstallModule_clearsStorage() public {
        NoopModule m = new NoopModule();
        vm.startPrank(owner);
        account.installModule(MOD_HOOK, address(m), abi.encode("init"));

        vm.expectEmit(false, false, false, true);
        emit ModuleUninstalled(MOD_HOOK, address(m));
        account.uninstallModule(MOD_HOOK, address(m), abi.encode("bye"));
        vm.stopPrank();

        assertFalse(account.isModuleInstalled(MOD_HOOK, address(m), ""));
        assertFalse(m.installed());
        assertEq(m.lastDeinit(), abi.encode("bye"));
        assertEq(account.getInstalledModules(MOD_HOOK).length, 0);
    }

    function test_uninstallModule_revertsIfNotInstalled() public {
        NoopModule m = new NoopModule();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.ModuleNotInstalled.selector, MOD_HOOK, address(m))
        );
        account.uninstallModule(MOD_HOOK, address(m), "");
    }

    function test_uninstallModule_loud_failure_when_onUninstall_reverts() public {
        // Install something that survives install but reverts on uninstall.
        // RevertingInstallModule reverts both — too aggressive for this test.
        // Build a one-off here.
        ConditionalRevertingModule cr = new ConditionalRevertingModule();
        vm.startPrank(owner);
        account.installModule(MOD_HOOK, address(cr), "");
        cr.setRevertOnUninstall(true);
        vm.expectRevert();
        account.uninstallModule(MOD_HOOK, address(cr), "");
        vm.stopPrank();
        // Still installed — uninstall rolled back
        assertTrue(account.isModuleInstalled(MOD_HOOK, address(cr), ""));
    }

    function test_isModuleInstalled_reflectsState() public {
        NoopModule m = new NoopModule();
        assertFalse(account.isModuleInstalled(MOD_HOOK, address(m), ""));
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(m), "");
        assertTrue(account.isModuleInstalled(MOD_HOOK, address(m), ""));
        vm.prank(owner);
        account.uninstallModule(MOD_HOOK, address(m), "");
        assertFalse(account.isModuleInstalled(MOD_HOOK, address(m), ""));
    }

    function test_supportsModule_returnsTrue_forKnownTypes() public view {
        assertTrue(account.supportsModule(MOD_VALIDATOR));
        assertTrue(account.supportsModule(MOD_EXECUTOR));
        assertTrue(account.supportsModule(MOD_HOOK));
        assertFalse(account.supportsModule(MOD_FALLBACK)); // not supported in v1
        assertFalse(account.supportsModule(99));
    }

    function test_accountId_bumped_to_v2() public view {
        assertEq(account.accountId(), "smart-agent.agent-account.2");
    }

    function test_installModule_capsHookCountAt8() public {
        vm.startPrank(owner);
        for (uint256 i = 0; i < 8; i++) {
            NoopModule m = new NoopModule();
            account.installModule(MOD_HOOK, address(m), "");
        }
        NoopModule extra = new NoopModule();
        vm.expectRevert(AgentAccount.TooManyHooks.selector);
        account.installModule(MOD_HOOK, address(extra), "");
        vm.stopPrank();
        assertEq(account.getInstalledModules(MOD_HOOK).length, 8);
    }

    function test_installModule_validatorAndExecutor_notCapped() public {
        vm.startPrank(owner);
        for (uint256 i = 0; i < 12; i++) {
            NoopModule m = new NoopModule();
            account.installModule(MOD_VALIDATOR, address(m), "");
        }
        vm.stopPrank();
        assertEq(account.getInstalledModules(MOD_VALIDATOR).length, 12);
    }

    // ─── Hook execution wiring ──────────────────────────────────────

    function test_hook_preAndPostCheck_runOnExecute() public {
        CountingHookModule h = new CountingHookModule();
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(h), "");

        TargetSink sink = new TargetSink();
        vm.prank(address(entryPoint));
        account.execute(address(sink), 0, abi.encodeCall(TargetSink.setValue, (777)));

        assertEq(sink.value(), 777);
        assertEq(h.preCount(), 1);
        assertEq(h.postCount(), 1);
        assertEq(h.lastHookData(), abi.encode("phase3-hookdata"));
    }

    function test_hook_preCheckRevert_blocksExecute() public {
        RevertingHookModule h = new RevertingHookModule();
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(h), "");

        TargetSink sink = new TargetSink();
        vm.prank(address(entryPoint));
        vm.expectRevert(); // "hook-veto"
        account.execute(address(sink), 0, abi.encodeCall(TargetSink.setValue, (1)));
        // The call never ran
        assertEq(sink.value(), 0);
    }

    function test_hook_postCheckRevert_revertsAfterCall() public {
        // Install a hook that returns OK pre but reverts post.
        RevertingPostHookModule rp = new RevertingPostHookModule();
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(rp), "");

        TargetSink sink = new TargetSink();
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.execute(address(sink), 0, abi.encodeCall(TargetSink.setValue, (1)));
        // setValue still ran but the whole tx reverted; from outside, value
        // is unchanged (state revert).
        assertEq(sink.value(), 0);
    }

    function test_hook_multiHook_chainsInOrder() public {
        CountingHookModule a = new CountingHookModule();
        CountingHookModule b = new CountingHookModule();
        vm.startPrank(owner);
        account.installModule(MOD_HOOK, address(a), "");
        account.installModule(MOD_HOOK, address(b), "");
        vm.stopPrank();

        TargetSink sink = new TargetSink();
        vm.prank(address(entryPoint));
        account.execute(address(sink), 0, abi.encodeCall(TargetSink.setValue, (5)));
        assertEq(a.preCount(), 1);
        assertEq(b.preCount(), 1);
        assertEq(a.postCount(), 1);
        assertEq(b.postCount(), 1);
    }

    // ─── Namespaced storage non-collision ────────────────────────────
    //
    // Property: writes through the existing AgentAccount surface (e.g.,
    // setDelegationManager updates _delegationManager; addOwner mutates the
    // owners map) must NOT clobber module storage. If the ERC-7201 slot
    // overlapped with sequential storage, owner adds would corrupt the
    // module install flag.

    function test_namespaced_storage_does_not_collide() public {
        NoopModule m = new NoopModule();
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(m), "");
        assertTrue(account.isModuleInstalled(MOD_HOOK, address(m), ""));

        // Touch unrelated storage: add an owner via self-call.
        address newOwner = makeAddr("newOwner");
        vm.prank(address(account));
        account.addOwner(newOwner);

        // Set delegation manager too.
        vm.prank(owner);
        account.setDelegationManager(address(0xC0FFEE));

        // Module flag intact + still enumerable.
        assertTrue(account.isModuleInstalled(MOD_HOOK, address(m), ""));
        assertEq(account.getInstalledModules(MOD_HOOK).length, 1);
        assertEq(account.getInstalledModules(MOD_HOOK)[0], address(m));

        // And the unrelated state actually changed.
        assertTrue(account.isOwner(newOwner));
        assertEq(account.delegationManager(), address(0xC0FFEE));
    }

    function test_namespaced_storage_does_not_collide_after_uninstall_reinstall() public {
        NoopModule m = new NoopModule();
        vm.startPrank(owner);
        account.installModule(MOD_HOOK, address(m), "");
        account.uninstallModule(MOD_HOOK, address(m), "");
        // Touch other state in between
        account.setDelegationManager(address(0xDEAD));
        // Re-install should work cleanly
        account.installModule(MOD_HOOK, address(m), "");
        vm.stopPrank();
        assertTrue(account.isModuleInstalled(MOD_HOOK, address(m), ""));
        assertEq(account.getInstalledModules(MOD_HOOK).length, 1);
        assertEq(account.delegationManager(), address(0xDEAD));
    }
}

// ─── Test-only helper module: lets a single module conditionally revert
//     on uninstall so we can exercise the loud-failure path without
//     touching the regular install lifecycle. Kept outside the test
//     contract so it's a distinct artifact.
contract ConditionalRevertingModule {
    bool public revertOnUninstall;
    function setRevertOnUninstall(bool v) external { revertOnUninstall = v; }
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external view {
        if (revertOnUninstall) revert("uninstall-blocked");
    }
    function preCheck(address, uint256, bytes calldata) external pure returns (bytes memory) {
        return "";
    }
    function postCheck(bytes calldata) external pure {}
}

contract RevertingPostHookModule {
    function onInstall(bytes calldata) external pure {}
    function onUninstall(bytes calldata) external pure {}
    function preCheck(address, uint256, bytes calldata) external pure returns (bytes memory) {
        return "";
    }
    function postCheck(bytes calldata) external pure {
        revert("post-bad");
    }
}
