// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/modules/SpendCapHookModule.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SpendCapModuleTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentAccount public account;
    SpendCapHookModule public module;
    MockERC20 public token;
    address public owner;

    uint256 constant MOD_HOOK = 4;

    function setUp() public {
        owner = makeAddr("owner");
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        account = factory.createAccount(owner, 0);
        vm.deal(address(account), 100 ether);
        module = new SpendCapHookModule();
        token = new MockERC20();
        token.mint(address(account), 1000 ether);
    }

    function _installWith(address asset, uint256 budget) internal {
        address[] memory assets = new address[](1);
        uint256[] memory budgets = new uint256[](1);
        assets[0] = asset;
        budgets[0] = budget;
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(module), abi.encode(assets, budgets));
    }

    function test_budget_set_on_install() public {
        _installWith(address(token), 100 ether);
        (uint256 max, uint256 spent) = module.getBudget(address(account), address(token));
        assertEq(max, 100 ether);
        assertEq(spent, 0);
    }

    function test_spending_below_budget_succeeds() public {
        _installWith(address(token), 100 ether);
        address recipient = makeAddr("recipient");
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 10 ether);

        vm.prank(address(entryPoint));
        account.execute(address(token), 0, callData);

        assertEq(token.balanceOf(recipient), 10 ether);
        (, uint256 spent) = module.getBudget(address(account), address(token));
        assertEq(spent, 10 ether);
    }

    function test_eleventh_transfer_reverts_when_budget_10() public {
        _installWith(address(token), 10 ether);
        address recipient = makeAddr("recipient");

        // 10 transfers of 1 ether each — all should succeed.
        for (uint256 i = 0; i < 10; i++) {
            bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1 ether);
            vm.prank(address(entryPoint));
            account.execute(address(token), 0, callData);
        }
        (, uint256 spent) = module.getBudget(address(account), address(token));
        assertEq(spent, 10 ether);

        // 11th — exceed.
        bytes memory tooMuch = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1 ether);
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.execute(address(token), 0, tooMuch);
    }

    function test_eth_value_charged_to_address_zero() public {
        _installWith(address(0), 5 ether);
        address payable recipient = payable(makeAddr("recipient"));

        vm.prank(address(entryPoint));
        account.execute(recipient, 2 ether, "");
        (, uint256 spent) = module.getBudget(address(account), address(0));
        assertEq(spent, 2 ether);

        // Next 4-ether send exceeds the 5-ether budget.
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.execute(recipient, 4 ether, "");
    }

    function test_self_call_not_charged() public {
        _installWith(address(0), 1 ether);
        // Account calls itself — should NOT charge ETH budget.
        // (Self-calls typically don't carry value but the SpendCap branch
        // skips on target==self before reading value, so test both shapes.)
        vm.prank(address(entryPoint));
        account.execute(address(account), 0, "");
        (, uint256 spent) = module.getBudget(address(account), address(0));
        assertEq(spent, 0);
    }

    function test_uninstall_clears_state() public {
        _installWith(address(token), 100 ether);
        // Spend some
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", makeAddr("r"), 10 ether);
        vm.prank(address(entryPoint));
        account.execute(address(token), 0, callData);

        // Uninstall
        vm.prank(owner);
        account.uninstallModule(MOD_HOOK, address(module), "");

        // State cleared
        (uint256 max, uint256 spent) = module.getBudget(address(account), address(token));
        assertEq(max, 0);
        assertEq(spent, 0);
        assertEq(module.listAssets(address(account)).length, 0);
    }

    function test_non_erc20_call_not_charged() public {
        _installWith(address(token), 5 ether);
        // Call a non-transfer selector on the token; budget shouldn't deplete.
        bytes memory cdMint = abi.encodeWithSignature("mint(address,uint256)", makeAddr("r"), 1 ether);
        vm.prank(address(entryPoint));
        account.execute(address(token), 0, cdMint);
        (, uint256 spent) = module.getBudget(address(account), address(token));
        assertEq(spent, 0);
    }
}
