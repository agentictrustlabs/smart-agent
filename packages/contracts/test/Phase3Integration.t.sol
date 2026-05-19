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
import "../src/modules/TargetSelectorAllowlistHookModule.sol";
import "../src/modules/RevocationModule.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";
import "./helpers/MockGovernance.sol";

/**
 * @title Phase3IntegrationTest
 * @notice End-to-end Phase 3 verification: a SessionAgentAccount with a
 *         SpendCap hook + rate-limit hook executes calls until the budget is
 *         exhausted; the 11th call reverts with SpendCapExceeded.
 */

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Phase3IntegrationTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public accountFactory;
    SessionAgentAccountFactory public sessionFactory;
    DelegationManager public dm;

    ECDSASessionValidator public validator;
    SpendCapHookModule public spendCap;
    RateLimitHookModule public rateLimit;
    TargetSelectorAllowlistHookModule public allowlist;
    RevocationModule public revocation;

    MockERC20 public token;
    address public user;
    address public sessionSigner;
    uint256 public sessionSignerKey;
    AgentAccount public sessionAgentAccount;

    function setUp() public {
        user = makeAddr("user");
        (sessionSigner, sessionSignerKey) = makeAddrAndKey("session-signer");

        entryPoint = new EntryPoint();
        dm = new DelegationManager();
        accountFactory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(dm), address(this), address(this), address(new MockGovernance(address(this))));
        sessionFactory = new SessionAgentAccountFactory(accountFactory);

        validator = new ECDSASessionValidator();
        spendCap = new SpendCapHookModule();
        rateLimit = new RateLimitHookModule();
        allowlist = new TargetSelectorAllowlistHookModule();
        revocation = new RevocationModule();

        token = new MockERC20();
    }

    function _deploy(uint256 budget, uint256 rlMax) internal returns (address) {
        address[] memory validators = new address[](1);
        bytes[] memory validatorInits = new bytes[](1);
        validators[0] = address(validator);
        validatorInits[0] = abi.encode(keccak256("session"), sessionSigner, block.timestamp + 1 hours);

        address[] memory hooks = new address[](2);
        bytes[] memory hookInits = new bytes[](2);
        hooks[0] = address(spendCap);
        address[] memory assets = new address[](1);
        uint256[] memory budgets = new uint256[](1);
        assets[0] = address(token);
        budgets[0] = budget;
        hookInits[0] = abi.encode(assets, budgets);
        hooks[1] = address(rateLimit);
        hookInits[1] = abi.encode(uint256(3600), uint256(rlMax));

        bytes32 salt = keccak256("phase3-int");
        return sessionFactory.deploySession(
            sessionSigner, salt, validators, validatorInits, hooks, hookInits
        );
    }

    function test_spendCap_exhaustion_blocks_eleventh_call() public {
        address account = _deploy(10 ether, 100);
        sessionAgentAccount = AgentAccount(payable(account));
        token.mint(account, 100 ether);
        address recipient = makeAddr("recipient");

        // 10 transfers of 1 ether each — all succeed.
        for (uint256 i = 0; i < 10; i++) {
            bytes memory cd = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1 ether);
            vm.prank(address(entryPoint));
            sessionAgentAccount.execute(address(token), 0, cd);
        }
        assertEq(token.balanceOf(recipient), 10 ether);

        // 11th — SpendCapHookModule.preCheck reverts.
        bytes memory cd = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1 ether);
        vm.prank(address(entryPoint));
        vm.expectRevert();
        sessionAgentAccount.execute(address(token), 0, cd);
    }

    function test_modules_can_be_uninstalled_state_cleared() public {
        address account = _deploy(10 ether, 5);
        sessionAgentAccount = AgentAccount(payable(account));
        token.mint(account, 100 ether);

        // Consume some budget
        bytes memory cd = abi.encodeWithSignature("transfer(address,uint256)", makeAddr("r"), 3 ether);
        vm.prank(address(entryPoint));
        sessionAgentAccount.execute(address(token), 0, cd);

        // Uninstall via the session-key owner (primary owner from initialize).
        vm.prank(sessionSigner);
        sessionAgentAccount.uninstallModule(4, address(spendCap), "");

        // Budget cleared
        (uint256 max, uint256 spent) = spendCap.getBudget(account, address(token));
        assertEq(max, 0);
        assertEq(spent, 0);
        // Module no longer in installed list
        assertFalse(sessionAgentAccount.isModuleInstalled(4, address(spendCap), ""));
    }

    function test_rate_limit_blocks_after_max_calls() public {
        address account = _deploy(1000 ether, 3);
        sessionAgentAccount = AgentAccount(payable(account));
        token.mint(account, 1000 ether);
        bytes memory cd = abi.encodeWithSignature("transfer(address,uint256)", makeAddr("r"), 1 ether);

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(address(entryPoint));
            sessionAgentAccount.execute(address(token), 0, cd);
        }
        // 4th call — RateLimitHookModule reverts in preCheck.
        vm.prank(address(entryPoint));
        vm.expectRevert();
        sessionAgentAccount.execute(address(token), 0, cd);
    }

    function test_account_id_signals_phase3() public {
        address account = _deploy(10 ether, 100);
        assertEq(AgentAccount(payable(account)).accountId(), "smart-agent.agent-account.2");
    }
}
