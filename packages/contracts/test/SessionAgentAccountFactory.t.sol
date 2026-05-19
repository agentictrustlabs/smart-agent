// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/DelegationManager.sol";
import "../src/SessionAgentAccountFactory.sol";
import "../src/modules/ECDSASessionValidator.sol";
import "../src/modules/SpendCapHookModule.sol";
import "../src/modules/RateLimitHookModule.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";
import "./helpers/MockGovernance.sol";

contract SessionAgentAccountFactoryTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public accountFactory;
    SessionAgentAccountFactory public sessionFactory;
    DelegationManager public dm;
    address public deployer;
    address public user;
    uint256 public userKey;
    address public sessionSigner;

    function setUp() public {
        deployer = makeAddr("deployer");
        (user, userKey) = makeAddrAndKey("user");
        sessionSigner = makeAddr("session-signer");

        entryPoint = new EntryPoint();
        dm = new DelegationManager();
        accountFactory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(dm), deployer, deployer, address(new MockGovernance(address(this))));
        sessionFactory = new SessionAgentAccountFactory(accountFactory);
    }

    function test_deploySession_atomically_deploysAndInstallsModules() public {
        ECDSASessionValidator validator = new ECDSASessionValidator();
        SpendCapHookModule spendCap = new SpendCapHookModule();
        RateLimitHookModule rateLimit = new RateLimitHookModule();

        address[] memory validators = new address[](1);
        bytes[] memory validatorInits = new bytes[](1);
        validators[0] = address(validator);
        validatorInits[0] = abi.encode(keccak256("sess-1"), sessionSigner, block.timestamp + 1 hours);

        address[] memory hooks = new address[](2);
        bytes[] memory hookInits = new bytes[](2);
        hooks[0] = address(spendCap);
        address[] memory assets = new address[](1);
        uint256[] memory budgets = new uint256[](1);
        assets[0] = address(0);
        budgets[0] = 5 ether;
        hookInits[0] = abi.encode(assets, budgets);
        hooks[1] = address(rateLimit);
        hookInits[1] = abi.encode(uint256(3600), uint256(100));

        bytes32 salt = keccak256(abi.encode(user, "sess-1"));
        address predicted = sessionFactory.getAddress(user, salt);

        address account = sessionFactory.deploySession(
            user, salt, validators, validatorInits, hooks, hookInits
        );

        assertEq(account, predicted, "address matches prediction");

        AgentAccount aa = AgentAccount(payable(account));
        assertEq(aa.accountId(), "smart-agent.agent-account.2");
        assertTrue(aa.isOwner(user), "user is an owner");
        assertTrue(aa.isOwner(address(sessionFactory)), "factory is a co-owner");

        // Modules installed
        assertTrue(aa.isModuleInstalled(1, address(validator), ""));
        assertTrue(aa.isModuleInstalled(4, address(spendCap), ""));
        assertTrue(aa.isModuleInstalled(4, address(rateLimit), ""));

        // Validator session state survived
        (address s, uint256 e) = validator.getSession(account, keccak256("sess-1"));
        assertEq(s, sessionSigner);
        assertGt(e, block.timestamp);

        // Spend cap budget set
        (uint256 max, uint256 spent) = spendCap.getBudget(account, address(0));
        assertEq(max, 5 ether);
        assertEq(spent, 0);
    }

    function test_deploySession_revertsOnZeroOwner() public {
        address[] memory v = new address[](0);
        bytes[] memory vi = new bytes[](0);
        address[] memory h = new address[](0);
        bytes[] memory hi = new bytes[](0);
        vm.expectRevert(SessionAgentAccountFactory.ZeroAddress.selector);
        sessionFactory.deploySession(address(0), bytes32(uint256(1)), v, vi, h, hi);
    }

    function test_deploySession_revertsOnLengthMismatch() public {
        address[] memory v = new address[](1);
        v[0] = address(0xBEEF);
        bytes[] memory vi = new bytes[](0);
        address[] memory h = new address[](0);
        bytes[] memory hi = new bytes[](0);
        vm.expectRevert(SessionAgentAccountFactory.LengthMismatch.selector);
        sessionFactory.deploySession(user, bytes32(uint256(1)), v, vi, h, hi);
    }

    function test_deploySession_revertsOnRedeploy() public {
        address[] memory v = new address[](0);
        bytes[] memory vi = new bytes[](0);
        address[] memory h = new address[](0);
        bytes[] memory hi = new bytes[](0);
        bytes32 salt = bytes32(uint256(7));
        sessionFactory.deploySession(user, salt, v, vi, h, hi);
        vm.expectRevert();
        sessionFactory.deploySession(user, salt, v, vi, h, hi);
    }

    function test_deploySession_ownerCanUninstallAfter() public {
        SpendCapHookModule spendCap = new SpendCapHookModule();
        address[] memory validators = new address[](0);
        bytes[] memory validatorInits = new bytes[](0);
        address[] memory hooks = new address[](1);
        bytes[] memory hookInits = new bytes[](1);
        hooks[0] = address(spendCap);
        address[] memory assets = new address[](1);
        uint256[] memory budgets = new uint256[](1);
        assets[0] = address(0);
        budgets[0] = 5 ether;
        hookInits[0] = abi.encode(assets, budgets);

        bytes32 salt = keccak256("s2");
        address account = sessionFactory.deploySession(
            user, salt, validators, validatorInits, hooks, hookInits
        );

        AgentAccount aa = AgentAccount(payable(account));
        // user owner can uninstall after deploy
        vm.prank(user);
        aa.uninstallModule(4, address(spendCap), "");
        assertFalse(aa.isModuleInstalled(4, address(spendCap), ""));
    }
}
