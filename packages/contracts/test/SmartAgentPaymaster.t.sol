// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/SmartAgentPaymaster.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "account-abstraction/core/EntryPoint.sol";

contract SmartAgentPaymasterTest is Test {
    EntryPoint internal entryPoint;
    SmartAgentPaymaster internal paymaster;
    AgentAccountFactory internal factory;
    AgentAccount internal account;

    address internal owner;
    address internal accountOwner;
    uint256 internal accountOwnerKey;
    address payable internal bundler;
    address internal nonOwner;

    function setUp() public {
        owner = address(this);
        (accountOwner, accountOwnerKey) = makeAddrAndKey("accountOwner");
        bundler = payable(makeAddr("bundler"));
        nonOwner = makeAddr("nonOwner");

        entryPoint = new EntryPoint();
        paymaster = new SmartAgentPaymaster(IEntryPoint(address(entryPoint)), owner);

        // Smart account so the integration test has a real validating sender.
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), owner);
        account = factory.createAccount(accountOwner, 0);
        // Fund the account just so postOp accounting in EntryPoint doesn't
        // exercise the prefund fallback. With the paymaster sponsoring gas
        // this isn't strictly required, but it isolates the test from
        // account-balance accidents.
        vm.deal(address(account), 1 ether);

        vm.deal(owner, 100 ether);
    }

    // ─── Construction ────────────────────────────────────────────────

    function test_constructor_sets_entryPoint_and_owner() public view {
        assertEq(address(paymaster.entryPoint()), address(entryPoint), "entryPoint wired");
        assertEq(paymaster.owner(), owner, "owner wired");
        assertTrue(paymaster.devMode(), "ships in dev mode");
    }

    // ─── Stake + Deposit ─────────────────────────────────────────────

    function test_addStake_and_deposit_update_entryPoint_balances() public {
        paymaster.addStake{value: 1 ether}(uint32(1 days));
        paymaster.deposit{value: 5 ether}();

        // Deposit
        assertEq(paymaster.getDeposit(), 5 ether, "deposit on EntryPoint");
        assertEq(entryPoint.balanceOf(address(paymaster)), 5 ether, "EntryPoint.balanceOf matches");

        // Stake info
        IStakeManager.DepositInfo memory info = entryPoint.getDepositInfo(address(paymaster));
        assertEq(info.stake, 1 ether, "stake recorded");
        assertEq(info.unstakeDelaySec, uint32(1 days), "unstake delay recorded");
        assertTrue(info.staked, "staked flag set");
    }

    // ─── Validation policy ───────────────────────────────────────────

    /// @dev Calls the paymaster the same way EntryPoint would. We `vm.prank`
    ///      the EntryPoint address so the `_requireFromEntryPoint` gate passes.
    function _callValidate(PackedUserOperation memory op)
        internal
        returns (bytes memory context, uint256 validationData)
    {
        vm.prank(address(entryPoint));
        return paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_validatePaymasterUserOp_accepts_all_in_dev() public {
        PackedUserOperation memory op = _emptyUserOp(address(account));
        (bytes memory ctx, uint256 vd) = _callValidate(op);
        assertEq(ctx.length, 0, "empty context => EntryPoint skips postOp");
        assertEq(vd, 0, "validationData=0 (valid forever)");

        // Different random sender — still accepted in dev mode.
        op.sender = makeAddr("randomSender");
        (ctx, vd) = _callValidate(op);
        assertEq(ctx.length, 0);
        assertEq(vd, 0);
    }

    function test_validatePaymasterUserOp_rejects_non_listed_in_prod() public {
        paymaster.setDevMode(false);
        PackedUserOperation memory op = _emptyUserOp(makeAddr("randomSender"));
        vm.prank(address(entryPoint));
        vm.expectRevert(
            abi.encodeWithSelector(
                SmartAgentPaymaster.SenderNotAccepted.selector,
                op.sender
            )
        );
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_validatePaymasterUserOp_accepts_listed_in_prod() public {
        paymaster.setDevMode(false);
        paymaster.setAccepted(address(account), true);

        PackedUserOperation memory op = _emptyUserOp(address(account));
        (bytes memory ctx, uint256 vd) = _callValidate(op);
        assertEq(ctx.length, 0);
        assertEq(vd, 0);
    }

    function test_setAccepted_only_owner() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        paymaster.setAccepted(address(account), true);
    }

    function test_setDevMode_only_owner() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        paymaster.setDevMode(false);
    }

    // ─── End-to-end EntryPoint.handleOps sponsorship ─────────────────

    /// @notice Critical integration test: a userOp that sets
    ///         `paymasterAndData = paymaster` is successfully sponsored by the
    ///         EntryPoint, and the paymaster's deposit on EntryPoint is debited
    ///         to cover gas.
    function test_handleOps_sponsors_userOp_through_paymaster() public {
        paymaster.addStake{value: 1 ether}(uint32(1 days));
        paymaster.deposit{value: 5 ether}();
        uint256 depositBefore = paymaster.getDeposit();
        assertEq(depositBefore, 5 ether, "starting deposit");

        // Build a userOp that calls account.execute(recipient, 0.1 ether, "")
        address recipient = makeAddr("recipient");
        bytes memory callData = abi.encodeWithSelector(
            AgentAccount.execute.selector,
            recipient,
            uint256(0.1 ether),
            bytes("")
        );

        PackedUserOperation memory op = _emptyUserOp(address(account));
        op.callData = callData;
        op.nonce = entryPoint.getNonce(address(account), 0);
        // verificationGasLimit || callGasLimit
        op.accountGasLimits = bytes32((uint256(300_000) << 128) | uint256(200_000));
        op.preVerificationGas = 60_000;
        // maxPriorityFeePerGas || maxFeePerGas — set both to 1 gwei so the
        // refund math is deterministic.
        op.gasFees = bytes32((uint256(1 gwei) << 128) | uint256(1 gwei));
        // paymasterAndData = paymaster(20) || verificationGasLimit(16) || postOpGasLimit(16)
        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),  // paymasterVerificationGasLimit
            uint128(50_000)    // paymasterPostOpGasLimit
        );

        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(accountOwnerKey, ethSignedHash);
        op.signature = abi.encodePacked(r, s, v);

        // Submit through the bundler. The bundler's balance should NOT need to
        // cover op gas — the paymaster's deposit does. EntryPoint v0.7's
        // nonReentrant modifier requires `tx.origin == msg.sender` AND no
        // code at msg.sender, so we prank as a fresh EOA with both fields set.
        vm.deal(bundler, 0);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);

        // The inner call moved 0.1 ETH to the recipient.
        assertEq(recipient.balance, 0.1 ether, "inner call executed");

        // Paymaster's deposit was debited.
        uint256 depositAfter = paymaster.getDeposit();
        assertLt(depositAfter, depositBefore, "paymaster deposit debited");

        // Bundler was reimbursed (its EntryPoint balance is positive after
        // handleOps — EntryPoint credits the beneficiary).
        assertGt(bundler.balance, 0, "bundler reimbursed by EntryPoint");
    }

    // ─── withdrawTo ──────────────────────────────────────────────────

    function test_withdrawTo_succeeds_for_owner() public {
        paymaster.deposit{value: 2 ether}();
        address payable to = payable(makeAddr("withdraw-to"));
        paymaster.withdrawTo(to, 1 ether);
        assertEq(to.balance, 1 ether, "received 1 ETH");
        assertEq(paymaster.getDeposit(), 1 ether, "deposit reduced");
    }

    function test_withdrawTo_reverts_for_non_owner() public {
        paymaster.deposit{value: 2 ether}();
        vm.prank(nonOwner);
        vm.expectRevert();
        paymaster.withdrawTo(payable(nonOwner), 1 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _emptyUserOp(address sender) internal pure returns (PackedUserOperation memory op) {
        op = PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: hex"",
            callData: hex"",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: hex"",
            signature: hex""
        });
    }
}
